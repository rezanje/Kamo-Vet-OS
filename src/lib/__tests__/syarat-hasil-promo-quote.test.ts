import { beforeEach, expect, it, vi } from "vitest";

// Advisory server check used by the cashier screen (stage 3b): which syarat-hasil promos the HPP guard would drop for THIS cart.
// Same mock style as syarat-hasil-checkout-actions.test.ts.
const PRICE: Record<string, number> = { item: 20000, other: 20000, anc: 15000 };
const COST: Record<string, number> = { item: 17040, other: 17040, anc: 10000 };
const state = vi.hoisted(() => ({ rpcs: [] as string[], tables: [] as string[], shRows: [] as Record<string, unknown>[], flags: {} as Record<string, boolean>, user: true, shift: true }));
vi.mock("@/lib/harga-cabang", () => ({ loadHargaCabang: async () => new Map(), hargaCabang: (_m: unknown, id: string) => PRICE[id], applyHargaCabang: (options: unknown) => options }));
vi.mock("@/lib/promo-hitung", async original => ({ ...await original<typeof import("@/lib/promo-hitung")>(), loadPromoAktif: async () => [] }));
vi.mock("@/lib/satuan", async original => ({ ...await original<typeof import("@/lib/satuan")>(), loadUnitOptions: async () => new Map(Object.keys(PRICE).map(id => [id, [{ unit: "PCS", factor: 1, sell_price: PRICE[id], buy_price: 0 }]])) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user ? { id: "actor" } : null } }) },
  rpc: async (name: string, values: Record<string, unknown>) => { state.rpcs.push(`${name}:${String(values.p_flag ?? "")}`); return { data: state.flags[String(values.p_flag)] === true, error: null }; },
  from(table: string) {
    state.tables.push(table);
    const data: unknown = table === "items" ? Object.keys(PRICE).map(id => ({ id, code: id, nama: id, name: id, unit: "PCS", item_type: "Persediaan", sell_price: PRICE[id], buy_price: 0, min_sell_qty: 1, is_active: true }))
      : table === "stock_layers" ? Object.keys(PRICE).map(id => ({ id: `layer:${id}`, item_id: id, qty_left: 100, unit_cost: COST[id], exp_date: null, tanggal: "2026-10-15", created_at: "2026-10-15T00:00:00Z" }))
        : table === "promos" ? state.shRows : [];
    const query = {
      select: () => query, eq: () => query, in: () => query, gt: () => query, lte: () => query, not: () => query, order: () => query, range: () => query, limit: () => query,
      single: async () => ({ data: null, error: null }),
      maybeSingle: async () => ({ data: table === "cashier_shifts" ? (state.shift ? { id: "shift", branch_id: "branch" } : null) : table === "warehouses" ? { id: "warehouse" } : null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, count: Array.isArray(data) ? data.length : 0, error: null }).then(resolve),
    };
    return query;
  },
}) }));
import { quotePromoGuard } from "@/app/kasir/promo-quote";

const RULE = (value: number, allowed = false) => ({
  discount_mode: "syarat_hasil", suggest: "x",
  syarat_hasil: {
    version: 1, repeat: true,
    syarat: [{ kind: "qty", min: 2, items: [{ item_id: "item", unit: "PCS" }, { item_id: "other", unit: "PCS" }] }],
    hasil: { kind: "barang", items: [{ item_id: "anc", unit: "PCS" }], discount: { type: "nominal", value } },
    below_hpp: allowed ? { allowed: true, reason: "barang mendekati expired", ack_by: "o", ack_at: "t" } : { allowed: false },
  },
});
const promo = (value: number, allowed = false) => ({ id: "sh1", name: "Beli 2 Bolt, ANC", rule: RULE(value, allowed), branch_ids: null, valid_from: null, valid_until: null });
const line = (item_id: string, qty: number) => ({ item_id, satuan: "PCS", qty, harga: PRICE[item_id] });
const ON = { syarat_hasil: true, promo_picker: true, below_hpp: false };

beforeEach(() => { Object.assign(state, { rpcs: [], tables: [], shRows: [], flags: {}, user: true, shift: true }); });

it("a reward that would sell below FIFO cost is reported as dropped (with the cashier note); an acceptable one is not", async () => {
  state.flags = ON;
  state.shRows = [promo(6000)];
  expect(await quotePromoGuard({ cart: [line("item", 2), line("anc", 1)], pick: "auto" })).toEqual({
    excluded: [{ promo_id: "sh1", name: "Beli 2 Bolt, ANC", reason: "below_hpp" }],
    notes: ['Promo "Beli 2 Bolt, ANC" tidak diterapkan: hadiah di bawah modal.'], waiverPromoIds: [],
  });
  state.shRows = [promo(1000)];
  expect(await quotePromoGuard({ cart: [line("item", 2), line("anc", 1)], pick: "auto" })).toEqual({ excluded: [], notes: [], waiverPromoIds: [] });
});
it("an Owner waiver (flag below_hpp released) keeps the promo and reports it as needing the no-receipt-discount rule", async () => {
  state.flags = { ...ON, below_hpp: true };
  state.shRows = [promo(6000, true)];
  expect(await quotePromoGuard({ cart: [line("item", 2), line("anc", 1)], pick: "auto" })).toEqual({ excluded: [], notes: [], waiverPromoIds: ["sh1"] });
});
it("flags OFF / no syarat-hasil promo: nothing is dropped and no stock layer is read", async () => {
  state.shRows = [promo(6000)];
  expect(await quotePromoGuard({ cart: [line("item", 2), line("anc", 1)], pick: "auto" })).toEqual({ excluded: [], notes: [], waiverPromoIds: [] });
  state.shRows = []; state.flags = ON; state.tables = [];
  expect(await quotePromoGuard({ cart: [line("item", 2), line("anc", 1)], pick: "auto" })).toEqual({ excluded: [], notes: [], waiverPromoIds: [] });
  expect(state.tables).not.toContain("stock_layers");
});
it("a cart without a claim does not read stock layers (cheap common path)", async () => {
  state.flags = ON; state.shRows = [promo(6000)]; state.tables = [];
  expect(await quotePromoGuard({ cart: [line("item", 2)], pick: "auto" })).toEqual({ excluded: [], notes: [], waiverPromoIds: [] });
  expect(state.tables).not.toContain("stock_layers");
  expect(state.tables).not.toContain("warehouses");
});
it("the client's price/promo numbers are not trusted: a forged harga above the master and a forged official price change nothing", async () => {
  state.flags = ON; state.shRows = [promo(6000)];
  const forged = [{ ...line("item", 2), harga: 999999, official_price: 1 }, { ...line("anc", 1), harga: 999999, promo_discount: 5 }];
  expect((await quotePromoGuard({ cart: forged as never, pick: "auto" })).excluded.map(e => e.promo_id)).toEqual(["sh1"]);
});
it("requires a logged-in cashier with an open shift (otherwise a clear error, nothing computed)", async () => {
  state.user = false;
  await expect(quotePromoGuard({ cart: [line("item", 2)], pick: "auto" })).rejects.toThrow(/masuk/i);
  state.user = true; state.shift = false;
  await expect(quotePromoGuard({ cart: [line("item", 2)], pick: "auto" })).rejects.toThrow(/shift/i);
});
