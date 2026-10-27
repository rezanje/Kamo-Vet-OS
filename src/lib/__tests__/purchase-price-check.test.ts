import { describe, expect, it } from "vitest";
import { deviatingLines, itemHppMap, loadItemHpp, priceCheckBeforeSave, priceDeviation, priceWarningMessage } from "@/lib/purchase-price-check";

const hpp = new Map([["a", 1_000]]);
const form = (confirm = false) => { const data = new FormData(); if (confirm) data.set("konfirmasi_harga", "1"); return data; };

/** Fake Supabase client: stock rows, item names and the actor's role. */
function client({ role = "ADMIN", stock = [{ id: "s1", item_id: "a", qty: 10, average_cost: 1_000 }], fail = false } = {}) {
  const calls: { table: string; inIds?: string[] }[] = [];
  return { calls, auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
    from: (table: string) => {
      const call: { table: string; inIds?: string[] } = { table }; calls.push(call);
      const q = { select: () => q, not: () => q, order: () => q, eq: () => q,
        in: (_: string, ids: string[]) => { call.inIds = ids; return table === "items" ? Promise.resolve({ data: [{ id: "a", name: "Vaksin A" }], error: null }) : q; },
        range: async () => fail ? { data: null, count: null, error: new Error("offline") } : { data: stock, count: stock.length, error: null },
        maybeSingle: async () => ({ data: { role, is_active: true }, error: null }) };
      return q;
    } };
}

describe("P04 purchase price deviation", () => {
  it("compares the price per base unit, not per purchase unit", () => {
    expect(priceDeviation(10_000, 10, 1_000)).toBe(0); // box of 10 at 10.000 = 1.000/pcs
    expect(priceDeviation(10_000, 1, 1_000)).toBe(9);  // same price typed per pcs
  });

  it("flags only beyond 50% either way", () => {
    expect(deviatingLines([{ item_id: "a", harga: 1_500, factor: 1 }, { item_id: "a", harga: 500, factor: 1 }], hpp)).toEqual([]);
    expect(deviatingLines([{ item_id: "a", harga: 1_501, factor: 1 }], hpp)).toHaveLength(1);
    expect(deviatingLines([{ item_id: "a", harga: 499, factor: 1 }], hpp)[0].deviation).toBeLessThan(0);
  });

  it("skips bonus lines priced 0 or blank, and items without HPP", () => {
    expect(priceDeviation(0, 1, 1_000)).toBeNull();
    expect(priceDeviation("", 1, 1_000)).toBeNull();
    expect(priceDeviation(null, 1, 1_000)).toBeNull();
    for (const base of [null, undefined, 0, -5, "abc"]) expect(priceDeviation(99_999, 1, base)).toBeNull();
    expect(deviatingLines([{ item_id: "b", harga: 99_999, factor: 1 }], hpp)).toEqual([]);
  });

  it("treats a missing or invalid factor as the base unit", () => {
    expect(priceDeviation(2_000, 0, 1_000)).toBe(1);
    expect(priceDeviation(2_000, null, 1_000)).toBe(1);
  });

  it("averages warehouse HPP weighted by positive stock, skipping unknown costs", () => {
    const map = itemHppMap([
      { item_id: "a", qty: 30, average_cost: 1_000 }, { item_id: "a", qty: 10, average_cost: "2000" },
      { item_id: "a", qty: -4, average_cost: 9_999 }, { item_id: "b", qty: 0, average_cost: 500 },
      { item_id: "b", qty: 0, average_cost: 700 }, { item_id: "c", qty: 5, average_cost: null }, { item_id: "d", qty: 5, average_cost: 0 },
    ]);
    expect(map.get("a")).toBe(1_250);
    expect(map.get("b")).toBe(600);
    expect(map.has("c")).toBe(false);
    expect(map.has("d")).toBe(false);
  });

  it("shows the percentage only to cost-reading roles", () => {
    const rows = [{ itemId: "a", deviation: 0.8 }], names = new Map([["a", "Vaksin A"]]);
    expect(priceWarningMessage(rows, names, true)).toContain("Vaksin A (80% lebih mahal)");
    const plain = priceWarningMessage(rows, names, false)!;
    expect(plain).toContain("Harga jauh berbeda dari harga pokok rata-rata, periksa ulang: Vaksin A");
    expect(plain).not.toMatch(/%|HPP/);
    expect(priceWarningMessage([], names, true)).toBeNull();
  });

  it("reads HPP only for the submitted line items", async () => {
    const db = client();
    expect((await loadItemHpp(db, ["a", "a", ""])).get("a")).toBe(1_000);
    expect(db.calls.find(c => c.table === "stock")?.inIds).toEqual(["a"]);
  });
});

describe("P04 server check before save", () => {
  it("blocks an unconfirmed deviating line, with % for OWNER/FINANCE only", async () => {
    expect(await priceCheckBeforeSave(client({ role: "FINANCE" }), form(), [{ item_id: "a", harga: 3_000, factor: 1 }])).toContain("200% lebih mahal");
    const admin = await priceCheckBeforeSave(client({ role: "ADMIN" }), form(), [{ item_id: "a", harga: 3_000, factor: 1 }]);
    expect(admin).toContain("Vaksin A");
    expect(admin).not.toContain("%");
  });

  it("saves when confirmed, within limit, bonus-only, or HPP unreadable", async () => {
    const line = [{ item_id: "a", harga: 3_000, factor: 1 }];
    const confirmed = client();
    expect(await priceCheckBeforeSave(confirmed, form(true), line)).toBeNull();
    expect(confirmed.calls).toEqual([]); // confirmation skips the cost read entirely
    expect(await priceCheckBeforeSave(client(), form(), [{ item_id: "a", harga: 1_200, factor: 1 }])).toBeNull();
    const bonus = client();
    expect(await priceCheckBeforeSave(bonus, form(), [{ item_id: "a", harga: 0, factor: 1 }])).toBeNull();
    expect(bonus.calls).toEqual([]);
    expect(await priceCheckBeforeSave(client({ fail: true }), form(), line)).toBeNull();
  });
});
