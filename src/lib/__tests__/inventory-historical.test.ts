import { expect, it } from "vitest";
import Decimal from "decimal.js";
import { loadHistoricalInventory } from "../inventory-historical";
import { hariIniWIB } from "../tanggal";
import { clientFixture } from "./fixtures/hpp-report-client";

const settings = [{ id: true, method: "moving_average", activated_at: "2026-10-22T03:00:00Z" }];
const warehouses = [
  { id: "w1", branch_id: "b1", code: "W1", name: "Gudang lama" },
  { id: "w2", branch_id: "b2", code: "W2", name: "Gudang cabang" },
];
const events = [
  { id: 1, warehouse_id: "w1", item_id: "i", tanggal: "2026-10-22", source: "average-activation", source_ref: null, qty_delta: "5", value_delta: "500", qty_after: "5", value_after: "500", average_after: "100" },
  { id: 2, warehouse_id: "w1", item_id: "i", tanggal: "2026-10-23", source: "sale", source_ref: "SALE-1", qty_delta: "-2", value_delta: "-200", qty_after: "3", value_after: "300", average_after: "100" },
  { id: 3, warehouse_id: "w2", item_id: "i", tanggal: "2026-10-22", source: "average-activation", source_ref: null, qty_delta: "2", value_delta: "60", qty_after: "2", value_after: "60", average_after: "30" },
  { id: 4, warehouse_id: "w2", item_id: "i", tanggal: "2026-10-23", source: "purchase", source_ref: "PO-1", qty_delta: "1", value_delta: "33.125", qty_after: "3", value_after: "93.125", average_after: "31.041666666667" },
  { id: 5, warehouse_id: "w1", item_id: "i", tanggal: "2026-10-24", source: "sale", source_ref: "SALE-2", qty_delta: "-1", value_delta: "-100", qty_after: "2", value_after: "200", average_after: "100" },
];
const journalLines = [
  { id: "l1", account_id: "a1301", debit: "400", credit: "100", journal_entries: { tanggal: "2026-10-22", branch_id: "b1" } },
  { id: "l2", account_id: "a1301", debit: "90", credit: "0", journal_entries: { tanggal: "2026-10-23", branch_id: "b2" } },
  { id: "l3", account_id: "a1301", debit: "7", credit: "0", journal_entries: { tanggal: "2026-10-23", branch_id: null } },
  { id: "l4", account_id: "a1301", debit: "100", credit: "0", journal_entries: { tanggal: "2026-10-24", branch_id: "b1" } },
  { id: "l5", account_id: "other", debit: "1000", credit: "0", journal_entries: { tanggal: "2026-10-22", branch_id: "b1" } },
];
const tables = () => ({ inventory_costing_settings: settings, warehouses, inventory_cost_events: events,
  coa_accounts: [{ id: "a1301", code: "1301" }], journal_lines: journalLines });

it("uses dated average events for an exact branch/detail as-of total and ignores later moves", async () => {
  const { client, records } = clientFixture({ tables: tables() });
  const report = await loadHistoricalInventory(client, { tanggal: "2026-10-23" });
  expect(report.available).toBe(true);
  expect(report.rows.map(row => [row.branchId, row.qty, row.value, row.sourceRef]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
    ["b1", "3", "300", "SALE-1"], ["b2", "3", "93.125", "PO-1"],
  ]);
  expect(report.summary.map(row => row.value)).toEqual(["300", "93.125"]);
  expect(report.total).toBe("393.125");
  expect(report.summary.map(row => [row.ledgerValue, row.difference])).toEqual([["300", "0"], ["90", "3.125"]]);
  expect([report.scopedLedgerValue, report.scopedDifference, report.unallocatedLedger]).toEqual(["390", "3.125", "7"]);
  expect(report.summary.reduce((sum, branch) => sum.plus(branch.value!), new Decimal(0)).toFixed()).toBe(report.total);
  expect(records).toContainEqual({ table: "inventory_cost_events", method: "lte", args: ["tanggal", "2026-10-23"] });
  expect(records).toContainEqual({ table: "journal_lines", method: "lte", args: ["journal_entries.tanggal", "2026-10-23"] });
  expect(records).toContainEqual({ table: "journal_lines", method: "in", args: ["journal_entries.branch_id", ["b1", "b2"]] });
  expect(records).toContainEqual({ table: "journal_lines", method: "is", args: ["journal_entries.branch_id", null] });
  expect(records.some(record => record.table === "inventory_cost_events" && record.method === "select" && String(record.args[0]).includes("value_after::text"))).toBe(true);
  expect(records.some(record => record.table === "journal_lines" && record.method === "select" && String(record.args[0]).includes("debit::text,credit::text"))).toBe(true);
  expect(records.some(record => record.table === "stock_moves" || record.table === "stock_layers")).toBe(false);
});

it("adds every detail row in a branch with decimal precision", async () => {
  const extra = { id: 6, warehouse_id: "w1", item_id: "j", tanggal: "2026-10-23", source: "purchase", source_ref: "PO-2", qty_delta: "1", value_delta: "0.125", qty_after: "1", value_after: "0.125", average_after: "0.125" };
  const report = await loadHistoricalInventory(clientFixture({ tables: {
    ...tables(), inventory_cost_events: [...events, extra], items: [
      { id: "i", code: "SKU", name: "Obat lama", unit: "ml" },
      { id: "j", code: "SKU-J", name: "Barang lain", unit: "pcs" },
    ],
  } }).client, { tanggal: "2026-10-23" });
  expect(report.rows.filter(row => row.branchId === "b1").map(row => row.value).sort()).toEqual(["0.125", "300"]);
  expect(report.summary.find(branch => branch.id === "b1")?.value).toBe("300.125");
  expect(report.total).toBe("393.25");
});

it("preserves numeric text beyond JavaScript's safe integer and decimal precision", async () => {
  const huge = "9007199254740993.123456789123";
  const report = await loadHistoricalInventory(clientFixture({ tables: {
    ...tables(), inventory_cost_events: [{ ...events[0], qty_delta: "1", qty_after: "1", value_delta: huge, value_after: huge, average_after: huge }],
  } }).client, { tanggal: "2026-10-22", cabang: ["b1"] });
  expect(report.rows[0].value).toBe(huge);
  expect(report.total).toBe(huge);
});

it("refuses source numeric values beyond the report's exact arithmetic bound", async () => {
  const tooLarge = "9".repeat(80);
  await expect(loadHistoricalInventory(clientFixture({ tables: {
    ...tables(), inventory_cost_events: [{ ...events[0], value_delta: tooLarge, value_after: tooLarge, average_after: tooLarge }],
  } }).client, { tanggal: "2026-10-22", cabang: ["b1"] })).rejects.toThrow("Nilai tidak sah");
});

it("rejects a missing activation seed or middle event instead of inventing a starting balance", async () => {
  const first = { ...tables(), inventory_cost_events: events.filter(row => row.id !== 1) };
  await expect(loadHistoricalInventory(clientFixture({ tables: first }).client, { tanggal: "2026-10-23" })).rejects.toThrow("Riwayat qty");
  const broken = { ...tables(), inventory_cost_events: [events[0], { ...events[1], qty_after: "2" }] };
  await expect(loadHistoricalInventory(clientFixture({ tables: broken }).client, { tanggal: "2026-10-23" })).rejects.toThrow("Riwayat qty");
  const badValue = { ...tables(), inventory_cost_events: [events[0], { ...events[1], value_after: "299" }] };
  await expect(loadHistoricalInventory(clientFixture({ tables: badValue }).client, { tanggal: "2026-10-23" })).rejects.toThrow("Riwayat nilai");
});

it("keeps branch and total unavailable when a source value is unknown, while preserving known qty", async () => {
  const unknown = { ...tables(), inventory_cost_events: events.map(row => row.id === 2 ? { ...row, value_delta: null, value_after: null } : row) };
  const report = await loadHistoricalInventory(clientFixture({ tables: unknown }).client, { tanggal: "2026-10-23" });
  expect(report.rows.find(row => row.branchId === "b1")).toMatchObject({ qty: "3", value: null });
  expect(report.summary.map(row => row.value)).toEqual([null, "93.125"]);
  expect(report.total).toBeNull();
});

it("restarts a known value after an unknown-cost position returns to zero, like the saved closing", async () => {
  // Fictional item sold before any priced receipt: the recorded value is unknown
  // while stock is minus, then exactly zero once the receipt brings qty back to zero.
  const recovered = [
    { id: 6, warehouse_id: "w1", item_id: "k", tanggal: "2026-10-22", source: "average-activation", source_ref: null, qty_delta: "0", value_delta: "0", qty_after: "0", value_after: "0", average_after: null },
    { id: 7, warehouse_id: "w1", item_id: "k", tanggal: "2026-10-22", source: "sale", source_ref: "SALE-K1", qty_delta: "-1", value_delta: null, qty_after: "-1", value_after: null, average_after: null },
    { id: 8, warehouse_id: "w1", item_id: "k", tanggal: "2026-10-23", source: "purchase", source_ref: "PO-K1", qty_delta: "1", value_delta: null, qty_after: "0", value_after: "0", average_after: "10" },
    { id: 9, warehouse_id: "w1", item_id: "k", tanggal: "2026-10-23", source: "purchase", source_ref: "PO-K2", qty_delta: "5", value_delta: "50", qty_after: "5", value_after: "50", average_after: "10" },
  ];
  const fixture = { ...tables(), inventory_cost_events: [...events, ...recovered], items: [
    { id: "i", code: "SKU", name: "Obat lama", unit: "ml" },
    { id: "k", code: "SKU-K", name: "Barang minus", unit: "pcs" },
  ] };
  // While the minus position has no cost, the item and its totals stay unavailable.
  const during = await loadHistoricalInventory(clientFixture({ tables: fixture }).client, { tanggal: "2026-10-22" });
  expect(during.rows.find(row => row.itemCode === "SKU-K")).toMatchObject({ qty: "-1", value: null });
  expect(during.total).toBeNull();
  const after = await loadHistoricalInventory(clientFixture({ tables: fixture }).client, { tanggal: "2026-10-23" });
  expect(after.rows.find(row => row.itemCode === "SKU-K")).toMatchObject({ qty: "5", value: "50" });
  expect(after.summary.map(row => row.value)).toEqual(["350", "93.125"]);
  expect(after.total).toBe("443.125");
  // A contradiction after the restart is still rejected rather than accepted.
  const contradicted = { ...fixture, inventory_cost_events: [...events, ...recovered.slice(0, 3), { ...recovered[3], value_after: "49" }] };
  await expect(loadHistoricalInventory(clientFixture({ tables: contradicted }).client, { tanggal: "2026-10-23" })).rejects.toThrow("Riwayat nilai");
});

it("shows a recorded negative position without deciding its accounting policy", async () => {
  const negativeEvents = [
    { ...events[0], qty_delta: "0", value_delta: "0", qty_after: "0", value_after: "0", average_after: null },
    { ...events[1], source: "opname", qty_delta: "-1", value_delta: "-10", qty_after: "-1", value_after: "-10", average_after: "10" },
  ];
  const report = await loadHistoricalInventory(clientFixture({ tables: { ...tables(), inventory_cost_events: negativeEvents } }).client,
    { tanggal: "2026-10-23", cabang: ["b1"] });
  expect(report.rows[0]).toMatchObject({ qty: "-1", value: "-10", negative: true });
  expect(report.summary[0]).toMatchObject({ negativeCount: 1, value: "-10" });
});

it("does not infer FIFO or pre-activation history and makes no event read in those periods", async () => {
  const fifo = clientFixture({ tables: { ...tables(), inventory_costing_settings: [{ id: true, method: "fifo", activated_at: null }] } });
  const fifoReport = await loadHistoricalInventory(fifo.client, { tanggal: "2026-10-23" });
  expect(fifoReport.available).toBe(false);
  expect(fifo.records.some(row => row.table === "inventory_cost_events")).toBe(false);
  const earlier = clientFixture({ tables: tables() });
  expect((await loadHistoricalInventory(earlier.client, { tanggal: "2026-10-21" })).available).toBe(false);
  expect(earlier.records.some(row => row.table === "inventory_cost_events")).toBe(false);
});

it("blocks a wholly missing event stream when today's physical stock still has a balance", async () => {
  const incomplete = clientFixture({ tables: {
    ...tables(), inventory_cost_events: [], stock: [{ id: "s1", warehouse_id: "w1", item_id: "i", qty: "2" }],
  } });
  await expect(loadHistoricalInventory(incomplete.client, { tanggal: hariIniWIB(), cabang: ["b1"] })).rejects.toThrow("Event nilai persediaan tidak lengkap");
  const empty = await loadHistoricalInventory(clientFixture({ tables: {
    ...tables(), inventory_cost_events: [], stock: [{ id: "s1", warehouse_id: "w1", item_id: "i", qty: "0" }],
  } }).client, { tanggal: hariIniWIB(), cabang: ["b1"] });
  expect(empty.total).toBe("0");
});

it("blocks a nonzero latest event when its current stock row is missing", async () => {
  await expect(loadHistoricalInventory(clientFixture({ tables: {
    ...tables(), inventory_cost_events: [events[0]], stock: [],
  } }).client, { tanggal: hariIniWIB(), cabang: ["b1"] })).rejects.toThrow("tidak memiliki saldo stok");
});

it("enforces branch access and fails closed on incomplete event pages", async () => {
  await expect(loadHistoricalInventory(clientFixture({ deniedBranch: "b2", tables: tables() }).client,
    { tanggal: "2026-10-23", cabang: ["b2"] })).rejects.toMatchObject({ status: 403 });
  const limited = await loadHistoricalInventory(clientFixture({ deniedBranch: "b2", tables: tables() }).client, { tanggal: "2026-10-23" });
  expect(limited.summary).toEqual([{ id: "b1", name: "Satu", count: 1, value: "300", ledgerValue: "300", difference: "0", negativeCount: 0 }]);
  expect(limited.fullBranchAccess).toBe(false);
  await expect(loadHistoricalInventory(clientFixture({ missingCountTable: "inventory_cost_events", tables: tables() }).client,
    { tanggal: "2026-10-23" })).rejects.toThrow("jumlah pasti");
  await expect(loadHistoricalInventory(clientFixture({ errorTable: "inventory_cost_events", tables: tables() }).client,
    { tanggal: "2026-10-23" })).rejects.toThrow("read failed");
});

it("reads no GL lines without the separate Buku Besar module", async () => {
  const { client, records } = clientFixture({ role: "FINANCE", modules: [{ role: "FINANCE", module_id: "laporan" }], tables: tables() });
  const report = await loadHistoricalInventory(client,
    { tanggal: "2026-10-23", cabang: ["b1"] });
  expect(report.available).toBe(true);
  expect(report.canViewLedger).toBe(false);
  expect(report.scopedLedgerValue).toBeNull();
  expect(records.some(row => row.table === "coa_accounts" || row.table === "journal_lines")).toBe(false);
});

it("uses exact decimal journal amounts and excludes other branches from selected subtotal", async () => {
  const huge = "9007199254740993.123456789123";
  const report = await loadHistoricalInventory(clientFixture({ tables: {
    ...tables(), journal_lines: [{ id: "l1", account_id: "a1301", debit: huge, credit: "0.123456789123", journal_entries: { tanggal: "2026-10-22", branch_id: "b1" } }, ...journalLines.slice(1)],
  } }).client, { tanggal: "2026-10-23", cabang: ["b1"] });
  expect(report.scopedLedgerValue).toBe("9007199254740993");
  expect(report.scopedDifference).toBe("-9007199254740693");
  expect(report.unallocatedLedger).toBeNull();
});

it("leaves comparison unavailable when account 1301 is absent and fails on incomplete GL pages", async () => {
  const missing = await loadHistoricalInventory(clientFixture({ tables: { ...tables(), coa_accounts: [] } }).client, { tanggal: "2026-10-23" });
  expect(missing.total).toBe("393.125");
  expect(missing.scopedLedgerValue).toBeNull();
  await expect(loadHistoricalInventory(clientFixture({ tables: tables(), missingCountTable: "journal_lines" }).client,
    { tanggal: "2026-10-23" })).rejects.toThrow("jumlah pasti");
  await expect(loadHistoricalInventory(clientFixture({ tables: tables(), errorTable: "journal_lines" }).client,
    { tanggal: "2026-10-23" })).rejects.toThrow("read failed");
  await expect(loadHistoricalInventory(clientFixture({ tables: { ...tables(), journal_lines: [{ ...journalLines[0], debit: "NaN" }] } }).client,
    { tanggal: "2026-10-23" })).rejects.toThrow("tidak sah");
});

it("pages all selected GL lines and rejects a server-truncated GL page", async () => {
  const long = Array.from({ length: 1201 }, (_, index) => ({
    id: `l${String(index).padStart(4, "0")}`, account_id: "a1301", debit: "1", credit: "0",
    journal_entries: { tanggal: "2026-10-22", branch_id: "b1" },
  }));
  const { client, records } = clientFixture({ tables: { ...tables(), journal_lines: long } });
  const report = await loadHistoricalInventory(client, { tanggal: "2026-10-23", cabang: ["b1"] });
  expect(report.scopedLedgerValue).toBe("1201");
  expect(report.scopedDifference).toBe("-901");
  expect(records.filter(row => row.table === "journal_lines" && row.method === "range")).toHaveLength(3);
  await expect(loadHistoricalInventory(clientFixture({ tables: { ...tables(), journal_lines: long }, serverCap: 100 }).client,
    { tanggal: "2026-10-23", cabang: ["b1"] })).rejects.toThrow("terpotong");
});

it("reads all event pages before choosing the last event and total", async () => {
  const long = Array.from({ length: 1201 }, (_, index) => ({
    ...events[0], id: index + 1, qty_delta: index ? "0" : "5", value_delta: index ? "0" : "500", source: index ? "purchase" : "average-activation",
  }));
  const report = await loadHistoricalInventory(clientFixture({ tables: { ...tables(), inventory_cost_events: long } }).client, { tanggal: "2026-10-22" });
  expect(report.rows).toHaveLength(1);
  expect(report.rows[0].value).toBe("500");
  expect(report.total).toBe("500");
});
