import { describe, expect, it } from "vitest";
import { cashierPriceFloorIssue, cashierStockCostEvents, conservativeFifoCost, quoteCashierLineCosts } from "./cashier-price-floor";

const inventory = (harga: number, discount = 0, qty = 1, factor = 1) => ({
  nama: "Fiction inventory", item_type: "Persediaan", qty, harga, faktor: factor,
  item_discount_type: "nominal" as const, item_discount_value: discount,
});

describe("cashier inventory price floor", () => {
  it("blocks zero price even when the recorded FIFO cost is zero", () => {
    expect(cashierPriceFloorIssue([inventory(0)], 0, [0])).toContain("nol");
    expect(cashierPriceFloorIssue([inventory(2500, 2500)], 0, [2000])).toContain("nol");
    expect(cashierPriceFloorIssue([inventory(2500)], 2500, [null])).toContain("HPP aktif");
  });
  it("blocks item, transaction, voucher and point discounts below FIFO cost", () => {
    expect(cashierPriceFloorIssue([inventory(1500)], 1500, [2000])).toContain("HPP");
    expect(cashierPriceFloorIssue([inventory(2500, 300)], 2200, [2300])).toContain("HPP");
    expect(cashierPriceFloorIssue([inventory(2500)], 1900, [2000])).toContain("HPP");
  });
  it("proportionally allocates basket discounts without blocking a free service", () => {
    const service = { nama: "Fiction free service", item_type: "Jasa", qty: 1, harga: 0 };
    expect(cashierPriceFloorIssue([inventory(3000), service], 2500, [2000, null])).toBeNull();
    expect(cashierPriceFloorIssue([inventory(3000), service], 1500, [2000, null])).toContain("HPP");
  });
  it("uses quantity in base units for a sold package", () => {
    expect(cashierPriceFloorIssue([inventory(30000, 0, 1, 12)], 30000, [36000])).toContain("HPP");
    expect(cashierPriceFloorIssue([inventory(36000, 0, 1, 12)], 36000, [36000])).toBeNull();
  });
  it("quotes FIFO and covers unpriced or missing units with a conservative known cost", () => {
    const layers = [{ qty_left: 2, unit_cost: 1200 }, { qty_left: 1, unit_cost: 1500 }];
    expect(conservativeFifoCost(3, layers, 2000)).toBe(3900);
    expect(conservativeFifoCost(4, layers, 2000)).toBe(5900);
    expect(conservativeFifoCost(1, [{ qty_left: 1, unit_cost: 0 }], 1800)).toBe(1800);
    expect(conservativeFifoCost(1, [], 0)).toBeNull();
  });
  it("does not reuse the first line's cheap FIFO layer for a second line of the same SKU", () => {
    const costs = quoteCashierLineCosts([
      { item_id: "sku", item_type: "Persediaan", qty: 1, faktor: 1 },
      { item_id: "sku", item_type: "Persediaan", qty: 1, faktor: 1 },
    ], [{ item_id: "sku", qty_left: 1, unit_cost: 1000 }, { item_id: "sku", qty_left: 1, unit_cost: 2500 }], new Map([["sku", 2500]]));
    expect(costs).toEqual([1000, 2500]);
  });
  it("consumes a group component before pricing a following standalone inventory line", () => {
    const events = cashierStockCostEvents([
      { item_id: "bundle", item_type: "Grup", qty: 1, group_components: [{ item_type: "Persediaan", component_item_id: "sku", total_base_qty: 1 }] },
      { item_id: "sku", item_type: "Persediaan", qty: 1 },
    ]);
    expect(events.map(event => event.pricedLineIndex)).toEqual([null, 1]);
    expect(quoteCashierLineCosts(events, [
      { item_id: "sku", qty_left: 1, unit_cost: 1000 }, { item_id: "sku", qty_left: 1, unit_cost: 2500 },
    ], new Map([["sku", 2500]]))).toEqual([1000, 2500]);
  });
});
