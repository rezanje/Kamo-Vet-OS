import { describe, expect, it } from "vitest";
import { computeTotals, lineDiscount, lineSubtotal, matchPromos, type Promo } from "../pos-calc";

describe("lineDiscount / lineSubtotal", () => {
  it("nominal discount subtracts flat amount", () => {
    const l = { qty: 2, harga: 50000, item_discount_type: "nominal" as const, item_discount_value: 10000 };
    expect(lineDiscount(l)).toBe(10000);
    expect(lineSubtotal(l)).toBe(90000);
  });
  it("percent discount computed on line gross", () => {
    const l = { qty: 2, harga: 50000, item_discount_type: "percent" as const, item_discount_value: 10 };
    expect(lineDiscount(l)).toBe(10000);
  });
  it("clamps discount at line gross (never negative subtotal)", () => {
    const l = { qty: 1, harga: 5000, item_discount_type: "nominal" as const, item_discount_value: 99999 };
    expect(lineDiscount(l)).toBe(5000);
    expect(lineSubtotal(l)).toBe(0);
  });
  it("no discount type → zero", () => {
    expect(lineDiscount({ qty: 3, harga: 1000 })).toBe(0);
  });
});

describe("computeTotals — urutan item → transaksi → poin", () => {
  const lines = [
    { qty: 2, harga: 50000, item_discount_type: "percent" as const, item_discount_value: 10 }, // gross 100k, disc 10k
    { qty: 1, harga: 20000 }, // gross 20k
  ];
  it("applies item discounts first", () => {
    const t = computeTotals(lines, 0, 0, 0);
    expect(t.itemsGross).toBe(120000);
    expect(t.itemDiscountTotal).toBe(10000);
    expect(t.afterItems).toBe(110000);
    expect(t.total).toBe(110000);
  });
  it("caps transaction-level discount at remainder after item discounts", () => {
    const t = computeTotals(lines, 200000, 0, 0);
    expect(t.txnLevel).toBe(110000);
    expect(t.total).toBe(0);
  });
  it("poin applied last, capped at remainder", () => {
    const t = computeTotals(lines, 10000, 5000, 999999);
    expect(t.txnLevel).toBe(15000);
    expect(t.poin).toBe(95000);
    expect(t.total).toBe(0);
  });
  it("normal mixed case never negative", () => {
    const t = computeTotals(lines, 5000, 5000, 10000);
    expect(t.total).toBe(110000 - 10000 - 10000);
  });
});

describe("matchPromos", () => {
  const promos: Promo[] = [
    { id: "1", name: "Bundling", promo_type: "bundling", rule: { trigger_item_ids: ["A"], min_qty: 2, suggest: "s1" } },
    { id: "2", name: "Tebus", promo_type: "tebus_murah", rule: { min_subtotal: 100000, suggest: "s2" } },
    { id: "3", name: "QtyAll", promo_type: "diskon_produk", rule: { min_qty: 5 } },
  ];
  it("matches by trigger item qty", () => {
    const hits = matchPromos(promos, [{ item_id: "A", qty: 2, harga: 10000 }]);
    expect(hits.map((h) => h.id)).toContain("1");
  });
  it("does not match trigger below min_qty", () => {
    const hits = matchPromos(promos, [{ item_id: "A", qty: 1, harga: 10000 }]);
    expect(hits.map((h) => h.id)).not.toContain("1");
  });
  it("matches by min_subtotal", () => {
    const hits = matchPromos(promos, [{ item_id: "X", qty: 1, harga: 150000 }]);
    expect(hits.map((h) => h.id)).toEqual(["2"]);
  });
  it("matches by total qty when no trigger items", () => {
    const hits = matchPromos(promos, [{ item_id: "X", qty: 5, harga: 1000 }]);
    expect(hits.map((h) => h.id)).toContain("3");
  });
  it("empty cart matches nothing", () => {
    expect(matchPromos(promos, [])).toEqual([]);
  });
});
