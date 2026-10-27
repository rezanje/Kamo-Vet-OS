import { describe, expect, it } from "vitest";
import { deviatingLines, itemHppMap, lastPurchaseCostMap, layerCostMap, loadReferenceCost, priceCheckBeforeSave, priceDeviation, priceWarningMessage } from "@/lib/purchase-price-check";

const hpp = new Map([["a", 1_000]]);
const form = (confirm = false) => { const data = new FormData(); if (confirm) data.set("konfirmasi_harga", "1"); return data; };

type Tables = { stock?: unknown[]; stock_layers?: unknown[]; purchase_invoice_items?: unknown[] };
/** Fake Supabase client: cost tables, item names and the actor's role. Records which items each table was asked for. */
function client({ role = "ADMIN", tables = { stock: [{ id: "s1", item_id: "a", qty: 10, average_cost: 1_000 }] } as Tables, fail = false } = {}) {
  const calls: { table: string; inIds?: string[] }[] = [];
  return { calls, auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
    from: (table: string) => {
      const call: { table: string; inIds?: string[] } = { table }; calls.push(call);
      const rows = () => ((tables as Record<string, { item_id: string }[]>)[table] ?? []).filter(row => !call.inIds || call.inIds.includes(row.item_id));
      const q = { select: () => q, not: () => q, gt: () => q, is: () => q, order: () => q, eq: () => q,
        in: (_: string, ids: string[]) => { call.inIds = ids; return table === "items" ? Promise.resolve({ data: [{ id: "a", name: "Vaksin A" }], error: null }) : q; },
        range: async () => fail ? { data: null, count: null, error: new Error("offline") } : { data: rows(), count: rows().length, error: null },
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

  it("reads cost only for the submitted line items, preferring the moving average", async () => {
    const db = client({ tables: { stock: [{ id: "s1", item_id: "a", qty: 10, average_cost: 1_000 }], stock_layers: [{ id: "l1", item_id: "a", qty_left: 5, unit_cost: 99 }] } });
    expect((await loadReferenceCost(db, ["a", "a", ""])).get("a")).toBe(1_000);
    expect(db.calls.find(c => c.table === "stock")?.inIds).toEqual(["a"]);
    expect(db.calls.some(c => c.table === "stock_layers")).toBe(false); // already resolved
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

describe("P04 FIFO reference cost (production method)", () => {
  it("weights remaining FIFO layers by qty_left, ignoring exhausted and unpriced layers", () => {
    const map = layerCostMap([
      { item_id: "a", qty_left: 3, unit_cost: 1_000 }, { item_id: "a", qty_left: 1, unit_cost: 2_000 },
      { item_id: "a", qty_left: 0, unit_cost: 50_000 }, { item_id: "a", qty_left: 9, unit_cost: 0 },
      { item_id: "b", qty_left: 0, unit_cost: 700 },
    ]);
    expect(map.get("a")).toBe(1_250);
    expect(map.has("b")).toBe(false);
  });

  it("takes the latest active invoice line per base unit as last purchase cost", () => {
    const map = lastPurchaseCostMap([
      { id: "1", item_id: "a", harga: 900, faktor: 1, purchase_invoices: { tanggal: "2026-09-01", created_at: "2026-09-01T01:00:00Z" } },
      { id: "2", item_id: "a", harga: 12_000, faktor: 10, purchase_invoices: [{ tanggal: "2026-10-01", created_at: "2026-10-01T01:00:00Z" }] },
      { id: "3", item_id: "a", harga: 99_999, faktor: 1, purchase_invoices: { tanggal: "2026-10-20", voided_at: "2026-10-21T00:00:00Z" } },
      { id: "4", item_id: "a", harga: 0, faktor: 1, purchase_invoices: { tanggal: "2026-10-25" } },
    ]);
    expect(map.get("a")).toBe(1_200);
  });

  it("falls back moving average -> FIFO layers -> last purchase, per item, reading each source only for unresolved items", async () => {
    const db = client({ tables: {
      stock: [{ id: "s1", item_id: "avg", qty: 2, average_cost: 500 }, { id: "s2", item_id: "fifo", qty: 4, average_cost: null }],
      stock_layers: [{ id: "l1", item_id: "fifo", qty_left: 2, unit_cost: 300 }, { id: "l2", item_id: "fifo", qty_left: 2, unit_cost: 500 }],
      purchase_invoice_items: [{ id: "p1", item_id: "last", harga: 2_400, faktor: 12, purchase_invoices: { tanggal: "2026-10-01" } }],
    } });
    const costs = await loadReferenceCost(db, ["avg", "fifo", "last", "none"]);
    expect(Object.fromEntries(costs)).toEqual({ avg: 500, fifo: 400, last: 200 });
    expect(db.calls.find(c => c.table === "stock_layers")?.inIds).toEqual(["fifo", "last", "none"]);
    expect(db.calls.find(c => c.table === "purchase_invoice_items")?.inIds).toEqual(["last", "none"]);
  });

  it("warns on FIFO-only stock (no moving average) and skips items with no reference at all", async () => {
    const fifo = { stock_layers: [{ id: "l1", item_id: "a", qty_left: 10, unit_cost: 1_000 }] };
    expect(await priceCheckBeforeSave(client({ role: "OWNER", tables: fifo }), form(), [{ item_id: "a", harga: 30_000, factor: 10 }])).toContain("200% lebih mahal");
    expect(await priceCheckBeforeSave(client({ tables: fifo }), form(), [{ item_id: "a", harga: 10_000, factor: 10 }])).toBeNull();
    expect(await priceCheckBeforeSave(client({ tables: {} }), form(), [{ item_id: "a", harga: 30_000, factor: 1 }])).toBeNull();
  });

  it("uses the last purchase price when neither moving average nor open layers exist", async () => {
    const last = { purchase_invoice_items: [{ id: "p1", item_id: "a", harga: 1_000, faktor: 1, purchase_invoices: { tanggal: "2026-10-01" } }] };
    expect(await priceCheckBeforeSave(client({ tables: last }), form(), [{ item_id: "a", harga: 400, factor: 1 }])).toContain("Vaksin A");
  });
});
