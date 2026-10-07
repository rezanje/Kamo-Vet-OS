import { describe, expect, it } from "vitest";
import { loadCompoundReport, loadSkuInventoryCosts } from "../hpp-reports-server";
import { clientFixture } from "./fixtures/hpp-report-client";

const invoice = { id: "line", compound_recipe_id: "recipe", qty: 1, harga: 200, diskon_persen: 0, hpp: 50, deskripsi: "Racikan",
  invoices: { id: "invoice", visit_id: "visit", invoice_no: "INV", created_at: "2026-10-04T05:00:00Z", paid_status: "Lunas", voided_at: null,
    visits: { branch_id: "b1", dokter: "Dr A", doctor_id: "doctor" } } };
const params = { cabang: "b1", dari: "2026-10-04", sampai: "2026-10-04" };

describe("historical compound ingredient costs", () => {
  it("uses consumed issue quantities and costs, never current prices or recipe quantities", async () => {
    const fixture = clientFixture({ tables: { invoice_items: [invoice],
      report_compound_ingredients: [
        { id: "issue1", invoice_item_id: "line", recipe_id: "recipe", ingredient_id: "ingredient", item_id: "i", ingredient_name: "Obat", unit: "ml", qty: 2, unit_cost: 10 },
        { id: "issue2", invoice_item_id: "line", recipe_id: "recipe", ingredient_id: "ingredient", item_id: "i", ingredient_name: "Obat", unit: "ml", qty: 1, unit_cost: 30 },
      ] } });
    const report = await loadCompoundReport(fixture.client, params);
    expect(report.rows[0].ingredients).toEqual([{ id: "ingredient", itemId: "i", name: "Obat", unit: "ml", qty: 3, averageCost: 50 / 3, cost: 50 }]);
    expect(report.rows[0].ingredientCostComplete).toBe(true);
    expect(fixture.records.some(row => row.table === "stock_layers")).toBe(false);
  });
  it("marks missing and mismatched historical breakdown instead of inventing costs", async () => {
    const missing = await loadCompoundReport(clientFixture({ tables: { invoice_items: [invoice] } }).client, params);
    expect(missing.rows[0].ingredients).toEqual([]);
    expect(missing.rows[0].ingredientCostComplete).toBe(false);
    const mismatch = await loadCompoundReport(clientFixture({ tables: { invoice_items: [invoice], report_compound_ingredients: [
      { id: "issue", invoice_item_id: "line", recipe_id: "recipe", ingredient_id: "ingredient", item_id: "i", ingredient_name: "Obat", unit: "ml", qty: 1, unit_cost: 49 },
    ] } }).client, params);
    expect(mismatch.rows[0].ingredientCostComplete).toBe(false);
    expect(mismatch.rows[0].cost).toBe(50);
  });
  it("fails closed on incomplete historical reads and rejects wrong invoice or recipe linkage", async () => {
    await expect(loadCompoundReport(clientFixture({ errorTable: "report_compound_ingredients", tables: { invoice_items: [invoice] } }).client, params)).rejects.toThrow();
    await expect(loadCompoundReport(clientFixture({ tables: { invoice_items: [invoice], report_compound_ingredients: [
      { id: "issue", invoice_item_id: "line", recipe_id: "wrong", ingredient_id: "ingredient", item_id: "i", ingredient_name: "Obat", unit: "ml", qty: 1, unit_cost: 50 },
    ] } }).client, params)).rejects.toThrow();
  });
});

describe("SKU current FIFO average costs", () => {
  it("weights all accessible warehouse balances and excludes unrequested items", async () => {
    const fixture = clientFixture({ tables: {
      warehouses: [{ id: "w1", branch_id: "b1", name: "Klinik", code: "K", type: "VET", is_active: true }, { id: "w2", branch_id: "b2", name: "Toko", code: "T", type: "POS", is_active: true }],
      stock: [{ id: "s1", warehouse_id: "w1", item_id: "i", qty: 3 }, { id: "s2", warehouse_id: "w2", item_id: "i", qty: 1 }, { id: "s3", warehouse_id: "w1", item_id: "other", qty: 99 }],
      stock_layers: [{ id: "l1", warehouse_id: "w1", item_id: "i", qty_left: 3, unit_cost: 50 }, { id: "l2", warehouse_id: "w2", item_id: "i", qty_left: 1, unit_cost: 100 }],
    } });
    expect(await loadSkuInventoryCosts(fixture.client, ["i"])).toEqual([{ itemId: "i", averageCost: 62.5, flags: [] }]);
  });
  it("withholds an average when any warehouse is unreconciled or unpriced", async () => {
    expect(await loadSkuInventoryCosts(clientFixture({ tables: { stock: [{ id: "s", warehouse_id: "w1", item_id: "i", qty: 4 }] } }).client, ["i"]))
      .toEqual([{ itemId: "i", averageCost: null, flags: ["Selisih stok/lapisan"] }]);
  });
  it.each(["DOCTOR", "STAFF", "ADMIN"])("denies %s before reading costs", async role => {
    const { client, records } = clientFixture({ role });
    await expect(loadSkuInventoryCosts(client, ["i"])).rejects.toMatchObject({ status: 403 });
    expect(records.some(row => row.table === "stock_layers")).toBe(false);
  });
});

it("shows recipe quantities with unavailable costs only when the protected RPC is absent", async () => {
  const report = await loadCompoundReport(clientFixture({ tables: { invoice_items: [invoice], compounding_ingredients: [
    { id: "ingredient", recipe_id: "recipe", item_id: "i", ingredient_name: "Obat lama", quantity: 3, unit: "ml" },
  ] } }).client, params);
  expect(report.rows[0].ingredients).toEqual([{ id: "ingredient", itemId: "i", name: "Obat lama", unit: "ml", qty: 3, averageCost: null, cost: null }]);
  expect(report.rows[0].ingredientQtySource).toBe("Resep tersimpan");
  expect(report.rows[0].ingredientCostComplete).toBe(false);
  expect(report.summary.cost).toBe(50);
});

it("keeps all ingredient rows across ID batches beyond 5000 with unknown costs unchanged", async () => {
  const lines = Array.from({ length: 101 }, (_, i) => ({ ...invoice, id: `line-${i}`, compound_recipe_id: `recipe-${i}` }));
  const ingredients = lines.flatMap((line, i) => Array.from({ length: 50 }, (_, j) => ({
    id: `ingredient-${i}-${j}`, recipe_id: line.compound_recipe_id, item_id: "i", ingredient_name: "Obat", quantity: 1, unit: "ml",
  })));
  const report = await loadCompoundReport(clientFixture({ tables: { invoice_items: lines, compounding_ingredients: ingredients } }).client, params);
  expect(report.rows.flatMap(row => row.ingredients)).toHaveLength(ingredients.length);
  expect(report.rows.flatMap(row => row.ingredients).every(ingredient => ingredient.cost === null)).toBe(true);
  expect(report.summary.cost).toBe(lines.length * 50);
});

it("retains explicitly labeled recipe quantities when a complete ledger read has no historical issues", async () => {
  const report = await loadCompoundReport(clientFixture({ tables: { invoice_items: [invoice], report_compound_ingredients: [], compounding_ingredients: [
    { id: "ingredient", recipe_id: "recipe", item_id: "i", ingredient_name: "Obat", quantity: 3, unit: "ml" },
  ] } }).client, params);
  expect(report.rows[0].ingredients[0]).toMatchObject({ qty: 3, cost: null, averageCost: null });
  expect(report.rows[0].ingredientQtySource).toBe("Resep tersimpan");
  expect(report.rows[0].ingredientCostComplete).toBe(false);
});

it.each([0, -1, "NaN", null])("preserves valid invoice margin when legacy recipe quantity is invalid (%s)", async quantity => {
  const report = await loadCompoundReport(clientFixture({ tables: { invoice_items: [invoice], compounding_ingredients: [
    { id: "ingredient", recipe_id: "recipe", item_id: "i", ingredient_name: "Obat lama", quantity, unit: "ml" },
  ] } }).client, params);
  expect(report.rows[0].ingredients[0].qty).toBeNull();
  expect(report.rows[0].ingredients[0].cost).toBeNull();
  expect(report.rows[0].grossProfit).toBe(150);
  expect(report.summary.cost).toBe(50);
});
