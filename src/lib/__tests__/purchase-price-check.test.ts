import { describe, expect, it } from "vitest";
import { itemHppMap, loadItemHpp, priceDeviation, priceDeviationWarning } from "@/lib/purchase-price-check";

describe("P04 purchase price deviation", () => {
  it("compares the price per base unit, not per purchase unit", () => {
    // 1 box = 10 pcs; HPP 1.000/pcs. Box 10.000 = 1.000/pcs = no deviation.
    expect(priceDeviation(10_000, 10, 1_000)).toBe(0);
    expect(priceDeviationWarning(10_000, 10, 1_000)).toBeNull();
    // Same box price typed against pcs (factor 1) is a 900% deviation.
    expect(priceDeviationWarning(10_000, 1, 1_000)).toContain("900% lebih mahal");
  });

  it("warns only beyond 50% either way", () => {
    expect(priceDeviationWarning(1_500, 1, 1_000)).toBeNull();
    expect(priceDeviationWarning(500, 1, 1_000)).toBeNull();
    expect(priceDeviationWarning(1_501, 1, 1_000)).toContain("lebih mahal");
    expect(priceDeviationWarning(499, 1, 1_000)).toContain("lebih murah");
  });

  it("never warns when HPP is unknown or zero", () => {
    for (const hpp of [null, undefined, 0, -5, "abc"]) expect(priceDeviationWarning(99_999, 1, hpp)).toBeNull();
  });

  it("treats a missing or invalid factor as the base unit", () => {
    expect(priceDeviation(2_000, 0, 1_000)).toBe(1);
    expect(priceDeviation(2_000, null, 1_000)).toBe(1);
  });

  it("averages warehouse HPP weighted by positive stock, skipping unknown costs", () => {
    const map = itemHppMap([
      { item_id: "a", qty: 30, average_cost: 1_000 },
      { item_id: "a", qty: 10, average_cost: "2000" },
      { item_id: "a", qty: -4, average_cost: 9_999 },
      { item_id: "b", qty: 0, average_cost: 500 },
      { item_id: "b", qty: 0, average_cost: 700 },
      { item_id: "c", qty: 5, average_cost: null },
      { item_id: "d", qty: 5, average_cost: 0 },
    ]);
    expect(map.get("a")).toBe(1_250);
    expect(map.get("b")).toBe(600);
    expect(map.has("c")).toBe(false);
    expect(map.has("d")).toBe(false);
  });

  it("loads HPP for the requested items and degrades to no warning on read failure", async () => {
    const filters: string[][] = [];
    const ok = { from: () => { const q = { select: () => q, not: () => q, in: (_: string, ids: string[]) => { filters.push(ids); return q; }, order: () => q,
      range: async () => ({ data: [{ id: "s1", item_id: "a", qty: 2, average_cost: 100 }], count: 1, error: null }) }; return q; } };
    expect((await loadItemHpp(ok, ["a", "a", ""])).get("a")).toBe(100);
    expect(filters).toEqual([["a"]]);
    const broken = { from: () => { const q = { select: () => q, not: () => q, in: () => q, order: () => q,
      range: async () => ({ data: null, count: null, error: new Error("offline") }) }; return q; } };
    expect((await loadItemHpp(broken)).size).toBe(0);
  });
});
