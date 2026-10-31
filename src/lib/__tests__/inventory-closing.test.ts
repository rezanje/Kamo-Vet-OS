import { expect, it } from "vitest";
import { loadInventoryClosing } from "../inventory-closing";
import { clientFixture } from "./fixtures/hpp-report-client";

it("shows immutable snapshot values only for accessible branches", async () => {
  const result = await loadInventoryClosing(clientFixture({ averageMode: true, deniedBranch: "b2", tables: {
    warehouses: [{ id: "w1", branch_id: "b1", name: "Utama" }, { id: "w2", branch_id: "b2", name: "Rahasia" }],
    inventory_costing_settings: [{ id: true, method: "moving_average", activated_at: "2026-10-01T00:00:00Z" }],
    inventory_month_closes: [{ id: "c1", period: "2026-09-01", closed_through: "2026-09-30", closed_at: "2026-10-01T00:00:00Z", snapshot_count: 2, total_value: 999 }],
    inventory_month_values: [{ close_id: "c1", warehouse_id: "w1", item_id: "i", qty: 2, average_cost: 80, value: 160 }, { close_id: "c1", warehouse_id: "w2", item_id: "i", qty: 1, average_cost: 839, value: 839 }],
    stock: [{ id: "s", warehouse_id: "w1", item_id: "i", qty: 2, average_cost: 200 }],
  } }).client);
  expect(result.allBranches).toBe(false);
  expect(result.history[0]).toMatchObject({ scopedCount: 1, scopedValue: 160 });
  expect(result.values).toHaveLength(1);
  expect(result.values[0]).toMatchObject({ average_cost: 80, value: 160, warehouse: "Utama" });
});

it("denies nonfinancial roles and fails closed on incomplete snapshot reads", async () => {
  await expect(loadInventoryClosing(clientFixture({ role: "ADMIN" }).client)).rejects.toMatchObject({ status: 403 });
  await expect(loadInventoryClosing(clientFixture({ errorTable: "inventory_month_closes" }).client)).rejects.toThrow("read failed");
});

const historicalTables = () => ({
 warehouses: [{ id: 'w1', branch_id: 'b1', name: 'Utama' }, { id: 'w2', branch_id: 'b2', name: 'Cabang lama' }],
 inventory_month_closes: [{ id: 'c1', period: '2026-09-01', closed_through: '2026-09-30', closed_at: '2026-10-01T00:00:00Z' }],
 inventory_month_values: [{ close_id: 'c1', warehouse_id: 'w1', item_id: 'i', qty: 2, average_cost: 80, value: 160 }, { close_id: 'c1', warehouse_id: 'w2', item_id: 'i', qty: 1, average_cost: 40, value: 40 }],
 stock: [{ id: 'today', warehouse_id: 'w1', item_id: 'i', qty: 999, average_cost: 999 }],
});
it('filters one or multiple branches without changing global mutation authorization', async () => {
 const fixture = clientFixture({ tables: historicalTables() });
 const one = await loadInventoryClosing(fixture.client, 'c1', ['b2']);
 expect(one.values.map(r => r.warehouse_id)).toEqual(['w2']);
 expect(one.history[0].scopedValue).toBe(40); expect(one.allBranches).toBe(true);
 expect(one.branchSummary).toEqual([{ id: 'b2', name: 'Dua', count: 1, value: 40, ledgerValue: null, difference: null }]);
 const both = await loadInventoryClosing(fixture.client, 'c1', ['b1', 'b2', 'b1']);
 expect(both.branchSummary.map(r => r.value)).toEqual([160, 40]);
 expect(both.history[0].scopedValue).toBe(200);
 expect(fixture.records.some(r => ['stock','stock_layers'].includes(r.table))).toBe(false);
});
it('rejects unavailable branches and explicit missing snapshots rather than falling back to another scope/month', async () => {
 await expect(loadInventoryClosing(clientFixture({ deniedBranch: 'b2', tables: historicalTables() }).client, 'c1', ['b2'])).rejects.toMatchObject({ status: 403 });
 await expect(loadInventoryClosing(clientFixture({ tables: historicalTables() }).client, 'missing')).rejects.toThrow('Snapshot');
});
it('retains missing values as incomplete at branch and total level', async () => {
 const tables = historicalTables();
 const source = tables.inventory_month_values as Array<Record<string, unknown>>;
 source[1].value = null;
 const report = await loadInventoryClosing(clientFixture({ tables }).client, 'c1');
 expect(report.history[0].scopedValue).toBeNull();
 expect(report.branchSummary.find(r => r.id === 'b2')?.value).toBeNull();
});

it('reads more than 1000 historical rows and keeps exact decimal branch/total sums', async () => {
 const tables = historicalTables();
 tables.inventory_month_values = Array.from({length:1201},(_,n)=>({close_id:'c1',warehouse_id:n%2?'w2':'w1',item_id:'i'+n,qty:1,average_cost:0.1,value:0.1}));
 const report = await loadInventoryClosing(clientFixture({tables}).client,'c1');
 expect(report.values).toHaveLength(1201);
 expect(report.history[0].scopedValue).toBe(120.1);
 expect(report.branchSummary.map(r=>r.value)).toEqual([60.1,60]);
});

it('compares saved branch values with the currently visible GL 1301 as of the saved close date', async () => {
 const tables = { ...historicalTables(), coa_accounts:[{id:'a1301',code:'170001'}], journal_lines:[
  {id:'j1',account_id:'a1301',debit:'160.00',credit:'0',journal_entries:{tanggal:'2026-09-01',branch_id:'b1'}},
  {id:'j2',account_id:'a1301',debit:'30.00',credit:'0',journal_entries:{tanggal:'2026-09-30',branch_id:'b2'}},
  {id:'j3',account_id:'a1301',debit:'0',credit:'5.00',journal_entries:{tanggal:'2026-10-01',branch_id:'b2'}},
  {id:'j4',account_id:'a1301',debit:'12.00',credit:'0',journal_entries:{tanggal:'2026-09-30',branch_id:null}},
  {id:'j5',account_id:'other',debit:'1000',credit:'0',journal_entries:{tanggal:'2026-09-30',branch_id:'b1'}},
 ] };
 const {client,records} = clientFixture({tables});
 const report = await loadInventoryClosing(client,'c1');
 expect(report.branchSummary.map(r=>[r.value,r.ledgerValue,r.difference])).toEqual([[160,160,0],[40,30,10]]);
 expect(report.scopedLedgerValue).toBe(190);
 expect(report.scopedDifference).toBe(10);
 expect(report.unallocatedLedger).toBe(12);
 expect(records).toContainEqual({table:'journal_lines',method:'lte',args:['journal_entries.tanggal','2026-09-30']});
});

it('does not include a denied branch or branchless journal in an accessible branch comparison', async () => {
 const report = await loadInventoryClosing(clientFixture({deniedBranch:'b2',tables:{...historicalTables(),
  coa_accounts:[{id:'a1301',code:'170001'}],journal_lines:[
   {id:'j1',account_id:'a1301',debit:160,credit:0,journal_entries:{tanggal:'2026-09-30',branch_id:'b1'}},
   {id:'j2',account_id:'a1301',debit:999,credit:0,journal_entries:{tanggal:'2026-09-30',branch_id:'b2'}},
   {id:'j3',account_id:'a1301',debit:7,credit:0,journal_entries:{tanggal:'2026-09-30',branch_id:null}},
  ],
 }}).client,'c1');
 expect(report.branchSummary).toEqual([{id:'b1',name:'Satu',count:1,value:160,ledgerValue:160,difference:0}]);
 expect(report.scopedLedgerValue).toBe(160);
 expect(report.allBranches).toBe(false);
});

it('keeps missing GL account and incomplete snapshot values unavailable instead of treating them as zero', async () => {
 const tables = historicalTables();
 const source = tables.inventory_month_values as Array<Record<string, unknown>>;
 source[1].value = null;
 const report = await loadInventoryClosing(clientFixture({tables}).client,'c1');
 expect(report.branchSummary[0].ledgerValue).toBeNull();
 expect(report.branchSummary[1].difference).toBeNull();
 expect(report.scopedDifference).toBeNull();
});

it('fails closed when a GL 1301 read is incomplete or has invalid money or missing document', async () => {
 const base = { ...historicalTables(), coa_accounts:[{id:'a1301',code:'170001'}], journal_lines:[
  {id:'j1',account_id:'a1301',debit:'1',credit:'0',journal_entries:{tanggal:'2026-09-30',branch_id:'b1'}},
 ] };
 await expect(loadInventoryClosing(clientFixture({tables:base,errorTable:'journal_lines'}).client,'c1')).rejects.toThrow('read failed');
 await expect(loadInventoryClosing(clientFixture({tables:base,missingCountTable:'journal_lines'}).client,'c1')).rejects.toThrow('jumlah pasti');
 await expect(loadInventoryClosing(clientFixture({tables:{...base,journal_lines:[{...base.journal_lines[0],debit:'NaN'}]}}).client,'c1')).rejects.toThrow('tidak sah');
 await expect(loadInventoryClosing(clientFixture({tables:{...base,journal_lines:[{...base.journal_lines[0],journal_entries:{tanggal:'2026-09-30'}}]}}).client,'c1')).rejects.toThrow('Cabang jurnal');
});
