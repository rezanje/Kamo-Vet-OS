import { expect, it } from "vitest";
import { valueInventory } from "../hpp-reports";
import { loadInventoryReport } from "../hpp-reports-server";
import { reportContext } from "../hpp-reports-export";
import { clientFixture } from "./fixtures/hpp-report-client";

it("values moving average independently of physical acquisition prices", () => {
  const [row] = valueInventory([{ warehouseId: "w", itemId: "i", qty: 3, averageCost: 80 }], [
    { warehouseId: "w", itemId: "i", qtyLeft: 3, unitCost: 10 },
  ], "moving_average");
  expect(row).toMatchObject({ value: 240, pricedValue: 240, averageCost: 80, layerQty: 3, flags: [] });
});

it("retains known negative inventory valuation and physical reconciliation warnings", () => {
  const [row] = valueInventory([{ warehouseId: "w", itemId: "i", qty: -2, averageCost: 80 }], [], "moving_average");
  expect(row).toMatchObject({ value: -160, pricedValue: -160, averageCost: 80, layerQty: 0 });
  expect(row.flags).toContain("Stok negatif");
  expect(valueInventory([{ warehouseId: "w", itemId: "i", qty: 2, averageCost: null }], [], "moving_average")[0].value).toBeNull();
});

it("uses the costing method RPC and stock average rather than remaining layer prices", async () => {
  const report = await loadInventoryReport(clientFixture({ averageMode: true, tables: {
    stock: [{ id: "s", warehouse_id: "w1", item_id: "i", qty: -2, average_cost: 80 }], stock_layers: [],
  } }).client, {});
  expect(report.method).toBe("moving_average");
  expect(report.summary).toMatchObject({ value: -160, incomplete: 0, reconciliationCount: 1 });
  expect(report.rows[0].flags).toHaveLength(2);
  expect(reportContext(report)).toContainEqual(["Baris perlu rekonsiliasi / HPP", 1]);
  expect(reportContext(report)).toContainEqual(["Nilai persediaan lengkap", -160]);
});

it("counts one positive physical mismatch as one reconciliation row without hiding its known value", async () => {
  const report = await loadInventoryReport(clientFixture({ averageMode: true, tables: {
    stock: [{ id: "s", warehouse_id: "w1", item_id: "i", qty: 3, average_cost: 80 }], stock_layers: [],
  } }).client, {});
  expect(report.summary).toMatchObject({ value: 240, incomplete: 0, reconciliationCount: 1 });
  const filtered = await loadInventoryReport(clientFixture({ averageMode: true, tables: {
    stock: [{ id: "s", warehouse_id: "w1", item_id: "i", qty: 3, average_cost: 80 }], stock_layers: [],
  } }).client, { q: "missing" });
  expect(filtered.summary).toMatchObject({ count: 0, incomplete: 0, reconciliationCount: 0, value: 0 });
});

it("falls back only for a missing method RPC and rejects real read errors", async () => {
  expect((await loadInventoryReport(clientFixture({ methodError: { code: "PGRST202", message: "missing" } }).client, {})).method).toBe("fifo");
  await expect(loadInventoryReport(clientFixture({ methodError: { code: "42501", message: "denied" } }).client, {})).rejects.toThrow("denied");
});
