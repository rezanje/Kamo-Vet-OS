import { describe, expect, it } from "vitest";
import { loadInventoryReport, loadCompoundReport } from "../hpp-reports-server";
import { downloadHppReport } from "../hpp-reports-download";
import { clientFixture, type Row } from "./fixtures/hpp-report-client";

const id = (i: number) => String(i).padStart(5,"0");
const inventoryTables = (): Record<string,Row[]> => ({
  stock: [{ id: "s", warehouse_id: "w1", item_id: "i", qty: 1201 }],
  stock_layers: Array.from({ length: 1201 },(_,i) => ({ id: id(i), warehouse_id: "w1", item_id: "i", qty_left: 1, unit_cost: 50 })),
});
const compoundTables = (count = 1201): Record<string,Row[]> => ({
  invoice_items: Array.from({ length: count },(_,i) => ({ id: id(i), compound_recipe_id: `r${i}`, qty: 1, harga: 100, diskon_persen: 0, hpp: 50, deskripsi: `Racikan ${i}`,
    invoices: { id: "inv", visit_id: "visit", invoice_no: "INV", created_at: "2026-10-04T12:00:00+07:00", paid_status: "Lunas", voided_at: null, visits: { branch_id: "b1", dokter: "Dr A", doctor_id: "d" } } })),
});
const period = { dari: "2026-10-01", sampai: "2026-10-04" };
describe("report completeness through source collectors and downloads", () => {
  it("reads every row beyond 500 with exact filtered counts", async () => {
    const { client,records } = clientFixture({ tables: inventoryTables() });
    expect((await loadInventoryReport(client,{})).summary.value).toBe(60050);
    expect(records.filter(row => row.table === "stock_layers" && row.method === "select").every(row => (row.args[1] as { count: string } | undefined)?.count === "exact")).toBe(true);
    expect((await loadCompoundReport(clientFixture({ tables: compoundTables() }).client,period)).summary.cost).toBe(60050);
  });
  it.each(["inventory","compound"] as const)("rejects %s source server cap200 through loader and CSV", async kind => {
    const fixture = () => clientFixture({ serverCap: 200, tables: kind === "inventory" ? inventoryTables() : compoundTables() });
    await expect(kind === "inventory" ? loadInventoryReport(fixture().client,{}) : loadCompoundReport(fixture().client,period)).rejects.toThrow();
    const response = await downloadHppReport(fixture().client,kind,new Request(`https://example.test/unduh?dari=${period.dari}&sampai=${period.sampai}`));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });
  it.each(["delete","insert"])("rejects observed %s between inventory source pages and returns no CSV", async change => {
    const fixture = () => clientFixture({ tables: inventoryTables(), beforeRead: (table,n,tables) => {
      if (table !== "stock_layers" || n !== 2) return;
      if (change === "delete") tables.stock_layers.shift();
      else tables.stock_layers.unshift({ ...tables.stock_layers[0], id: "-0001" });
    } });
    await expect(loadInventoryReport(fixture().client,{})).rejects.toThrow();
    const response = await downloadHppReport(fixture().client,"inventory",new Request("https://example.test/unduh"));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });
  it("rejects duplicated IDs even when a replacement keeps the count unchanged", async () => {
    const fixture = () => clientFixture({ tables: inventoryTables(), beforeRead: (table,n,tables) => {
      if (table === "stock_layers" && n === 2) {
        tables.stock_layers.pop(); tables.stock_layers.unshift({ ...tables.stock_layers[0], id: "-0001" });
      }
    } });
    await expect(loadInventoryReport(fixture().client,{})).rejects.toThrow();
    expect((await downloadHppReport(fixture().client,"inventory",new Request("https://example.test/unduh"))).status).toBeGreaterThanOrEqual(400);
  });
  it("fails closed when exact count metadata is absent", async () => {
    const fixture = () => clientFixture({ tables: inventoryTables(), missingCountTable: "stock_layers" });
    await expect(loadInventoryReport(fixture().client,{})).rejects.toThrow();
    expect((await downloadHppReport(fixture().client,"inventory",new Request("https://example.test/unduh"))).status).toBeGreaterThanOrEqual(400);
  });
});

it("keeps a compound cohort beyond 5000 complete while retaining unknown historical costs", async () => {
  const tables = compoundTables(5201);
  tables.invoice_items[5200].hpp = null;
  const report = await loadCompoundReport(clientFixture({ tables }).client, period);
  expect(report.rows).toHaveLength(5201);
  expect(report.summary.revenue).toBe(520100);
  expect(report.summary.cost).toBe(260000);
  expect(report.summary.missingCost).toBe(1);
  expect(report.rows.find(row => row.id === id(5200))).toMatchObject({ cost: null, grossProfit: null, margin: null });
  expect(report.reconciliation).toEqual([expect.objectContaining({ id: id(5200), cost: null, margin: null })]);
});
