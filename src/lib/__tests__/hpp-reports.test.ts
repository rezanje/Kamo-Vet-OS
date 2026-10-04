import { describe, expect, it } from "vitest";
import { valueInventory, compoundSales, compoundSummary, validReportDate, paginateReport } from "../hpp-reports";

describe("current FIFO valuation", () => {
  it("uses remaining quantities and weighted layer prices in base units", () => {
    const rows = valueInventory([{ warehouseId: "w", itemId: "i", qty: 5.5 }], [
      { warehouseId: "w", itemId: "i", qtyLeft: 2.5, unitCost: 120 },
      { warehouseId: "w", itemId: "i", qtyLeft: 3, unitCost: 200 },
    ]);
    expect(rows[0]).toMatchObject({ stockQty: 5.5, layerQty: 5.5, difference: 0, pricedValue: 900, value: 900, averageCost: 900 / 5.5, flags: [] });
  });
  it("retains stock-only, layer-only, negative and unpriced balances without fictitious costs", () => {
    const rows = valueInventory([
      { warehouseId: "w", itemId: "stock-only", qty: 4 },
      { warehouseId: "w", itemId: "negative", qty: -1 },
      { warehouseId: "w", itemId: "unpriced", qty: 3 },
    ], [
      { warehouseId: "w", itemId: "layer-only", qtyLeft: 2, unitCost: 50 },
      { warehouseId: "w", itemId: "unpriced", qtyLeft: 1, unitCost: 20 },
      { warehouseId: "w", itemId: "unpriced", qtyLeft: 2, unitCost: 0 },
    ]);
    expect(rows).toHaveLength(4);
    expect(rows.find(r => r.itemId === "unpriced")).toMatchObject({ pricedValue: 20, unpricedQty: 2, value: null, averageCost: null });
    expect(rows.find(r => r.itemId === "stock-only")?.flags).toContain("Selisih stok/lapisan");
    expect(rows.find(r => r.itemId === "layer-only")).toMatchObject({ stockQty: null, value: null });
    expect(rows.find(r => r.itemId === "negative")?.flags).toContain("Stok negatif");
  });
  it("treats nonfinite and missing costs as unknown and ignores exhausted layers", () => {
    const rows = valueInventory([{ warehouseId: "w", itemId: "i", qty: 2 }], [
      { warehouseId: "w", itemId: "i", qtyLeft: 1, unitCost: null },
      { warehouseId: "w", itemId: "i", qtyLeft: 1, unitCost: NaN },
      { warehouseId: "w", itemId: "i", qtyLeft: 0, unitCost: 1000 },
    ]);
    expect(rows[0]).toMatchObject({ unpricedQty: 2, pricedValue: 0, value: null });
  });
  it("does not publish nonfinite layer value when otherwise finite inputs overflow", () => {
    const row = valueInventory([{ warehouseId: "w", itemId: "i", qty: 1e200 }], [
      { warehouseId: "w", itemId: "i", qtyLeft: 1e200, unitCost: 1e200 },
    ])[0];
    expect(row.value).toBeNull(); expect(row.pricedValue).toBe(0);
    expect(row.unpricedQty).toBe(1e200);
  });
  it("preserves real small quantity differences while ignoring floating-point addition noise", () => {
    const rows = valueInventory([
      { warehouseId: "w", itemId: "small", qty: 1.0000005 },
      { warehouseId: "w", itemId: "float", qty: 0.3 },
    ], [
      { warehouseId: "w", itemId: "small", qtyLeft: 1, unitCost: 100 },
      { warehouseId: "w", itemId: "float", qtyLeft: 0.1, unitCost: 100 },
      { warehouseId: "w", itemId: "float", qtyLeft: 0.2, unitCost: 100 },
    ]);
    expect(rows.find(row => row.itemId === "small")?.value).toBeNull();
    expect(rows.find(row => row.itemId === "float")?.value).toBe(30);
  });
  it("retains fractional monetary value so a small dose does not erase average HPP", () => {
    expect(valueInventory([{ warehouseId: "w", itemId: "i", qty: 0.00001 }], [
      { warehouseId: "w", itemId: "i", qtyLeft: 0.00001, unitCost: 100 },
    ])[0]).toMatchObject({ value: 0.001, averageCost: 100 });
  });
});

describe("compound billed sales", () => {
  const line = { id: "line", recipeId: "recipe", qty: 2, price: 100, discountPercent: 10, hpp: 50 };
  it("uses total historical line HPP exactly once and rounds net line revenue", () => {
    expect(compoundSales([line])[0]).toMatchObject({ revenue: 180, cost: 50, grossProfit: 130, margin: 130 / 180 * 100 });
    expect(compoundSales([{ ...line, qty: 1, price: 1.115, discountPercent: 0 }])[0].revenue).toBe(1.12);
  });
  it("preserves duplicate names by exact line/recipe ID and excludes unlinked legacy guesses", () => {
    const rows = compoundSales([line, { ...line, id: "second", recipeId: "another" }, { ...line, id: "legacy", recipeId: null }]);
    expect(rows.map(r => r.id)).toEqual(["line", "second"]);
    expect(rows.map(r => r.recipeId)).toEqual(["recipe", "another"]);
  });
  it("does not turn missing HPP into profit and excludes uncovered revenue from summary margin", () => {
    const rows = compoundSales([line, { ...line, id: "old", hpp: null }, { ...line, id: "zero", hpp: 0 }]);
    expect(rows[1]).toMatchObject({ cost: null, grossProfit: null, margin: null });
    expect(compoundSummary(rows)).toMatchObject({ revenue: 540, coveredRevenue: 180, cost: 50, grossProfit: 130, missingCost: 2, margin: 130 / 180 * 100 });
  });
  it("keeps zero-revenue costs and leaves margin undefined", () => {
    expect(compoundSales([{ ...line, discountPercent: 200 }])[0]).toMatchObject({ revenue: 0, cost: 50, grossProfit: -50, margin: null });
    expect(compoundSummary(compoundSales([{ ...line, hpp: null }]))).toMatchObject({ cost: null, grossProfit: null, margin: null });
  });
  it("fails closed on invalid quantities or nonfinite sale amounts", () => {
    expect(() => compoundSales([{ ...line, qty: null }])).toThrow("Nilai baris");
    expect(() => compoundSales([{ ...line, qty: 1e200, price: 1e200 }])).toThrow("Nilai baris");
  });
});

it("validates actual calendar dates and clamps display pagination while retaining full totals", () => {
  expect(validReportDate("2026-02-30")).toBe(false);
  expect(validReportDate("2024-02-29")).toBe(true);
  expect(paginateReport(Array.from({ length: 205 }, (_, i) => i), "99")).toMatchObject({ page: 3, pages: 3, rows: [200,201,202,203,204] });
  expect(paginateReport([1,2], "NaN").page).toBe(1);
});
