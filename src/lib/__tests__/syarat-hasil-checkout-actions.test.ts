import { beforeEach, expect, it, vi } from "vitest";

// Petshop cashier checkout x promo "syarat -> hasil" (stage 3). Same mock style as quantity-pool-checkout-actions.test.ts.
const PRICE: Record<string, number> = { item: 20000, other: 20000, anc: 15000 };
const COST: Record<string, number> = { item: 17040, other: 17040, anc: 10000 };
const state = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown }[], headers: [] as Record<string, unknown>[], items: [] as Record<string, unknown>[],
  removed: false, finalizationError: "", pool: true, shRows: [] as Record<string, unknown>[], flags: {} as Record<string, boolean>, flagError: "" as string, promoReads: 0, prior: null as null | Record<string, unknown>, campaign: null as null | Record<string, unknown>,
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/penjual", () => ({ penjualValid: async () => true }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "POS-SH-TEST" }) }));
vi.mock("@/lib/posting", () => ({ postJournal: async () => {} }));
vi.mock("@/lib/quest-hook", () => ({ processQuestProgress: async () => {} }));
vi.mock("@/lib/kode-kampanye", async original => ({ ...await original<typeof import("@/lib/kode-kampanye")>(), bacaKodeKampanye: async () => state.campaign }));
vi.mock("@/lib/harga-cabang", () => ({ loadHargaCabang: async () => new Map(), hargaCabang: (_m: unknown, id: string) => PRICE[id], applyHargaCabang: (options: unknown) => options }));
vi.mock("@/lib/promo-hitung", async original => ({ ...await original<typeof import("@/lib/promo-hitung")>(), loadPromoAktif: async () => (state.pool ? [{
  id: "pool", name: "Fictional pool", itemIds: ["item", "other"], unit: "PCS", minQty: 2, maxQty: null, kelipatan: true, autoApply: true, discountType: "nominal", discountValue: 1, discountMode: "quantity_pool",
  quantityPool: { version: 1, unit: "PCS", normal_price: 20000, tiers: [{ qty: 6, total: 110000 }, { qty: 2, total: 38000 }] },
}] : []) }));
vi.mock("@/lib/satuan", async original => ({ ...await original<typeof import("@/lib/satuan")>(), loadUnitOptions: async () => new Map(Object.keys(PRICE).map(id => [id, [{ unit: "PCS", factor: 1, sell_price: PRICE[id], buy_price: 0 }]])) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (name: string, values: Record<string, unknown>) => {
    state.calls.push({ name, args: values });
    if (name === "promo_release_enabled") return state.flagError ? { data: null, error: { code: state.flagError, message: "x" } } : { data: state.flags[String(values.p_flag)] === true, error: null };
    if (name === "refresh_customer_spending") return { data: true, error: null };
    if (name !== "finalize_pos_sale" && name !== "cashier_post_stock_atomic") throw Error(`Unexpected RPC ${name}`);
    if (state.finalizationError) return { data: null, error: { message: state.finalizationError } };
    return { data: { sale_id: values.p_sale_id, journal_id: "journal", finalized: true, ...(name !== "finalize_pos_sale" ? { checked: true } : {}) }, error: null };
  },
  from(table: string) {
    const eqs: Record<string, unknown> = {};
    let lookup = false;
    let data: unknown = table === "items" ? Object.keys(PRICE).map(id => ({ id, code: id, nama: id, name: id, unit: "PCS", item_type: "Persediaan", sell_price: PRICE[id], buy_price: 0, min_sell_qty: 1, is_active: true }))
      : table === "stock_layers" ? Object.keys(PRICE).map(id => ({ id: `layer:${id}`, item_id: id, qty_left: 100, unit_cost: COST[id], exp_date: null, tanggal: "2026-10-15", created_at: "2026-10-15T00:00:00Z" }))
        : table === "promos" ? state.shRows : [];
    const single = () => ({ data: table === "sales" && lookup ? state.prior : table === "cashier_shifts" ? { id: "shift", branch_id: "branch" } : table === "customers" ? { points: 0, total_spending: 0, category_id: null, customer_categories: null }
      : table === "warehouses" ? { id: "warehouse" } : { id: table === "sales" ? "sale" : "line" }, error: null });
    const query = {
      select: (fields: string) => { lookup = typeof fields === "string" && fields.includes("checkout_fingerprint"); return query; }, eq: (k: string, v: unknown) => { eqs[k] = v; if (table === "promos") state.promoReads++; return query; }, in: () => query, gt: () => query, lte: () => query, not: () => query, order: () => query, range: () => query, limit: () => query,
      insert: (value: Record<string, unknown>) => { if (table === "sales") { state.headers.push(value); data = value; state.prior = { id: "sale", no_struk: "POS-SH-TEST", checkout_fingerprint: value.checkout_fingerprint, payments_finalized_at: null }; } if (table === "sale_items") state.items.push({ id: "line", ...value }); return query; },
      update: () => query, delete: () => { if (table === "sales") { state.removed = true; state.prior = null; } return query; },
      single: async () => single(), maybeSingle: async () => single(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, count: Array.isArray(data) ? data.length : 0, error: null }).then(resolve),
    };
    return query;
  },
}) }));
import { checkoutKasir } from "@/app/kasir/checkout";

const RULE = (value: number) => ({
  discount_mode: "syarat_hasil", suggest: "x",
  syarat_hasil: {
    version: 1, repeat: true,
    syarat: [{ kind: "qty", min: 2, items: [{ item_id: "item", unit: "PCS" }, { item_id: "other", unit: "PCS" }] }],
    hasil: { kind: "barang", items: [{ item_id: "anc", unit: "PCS" }], discount: { type: "nominal", value } },
    below_hpp: { allowed: false },
  },
});
const shPromo = (value: number, extra: Record<string, unknown> = {}) => ({ id: "sh1", name: "Beli 2 Bolt, ANC -Rp1.000", rule: RULE(value), branch_ids: null, valid_from: null, valid_until: null, ...extra });
const ON = { syarat_hasil: true, promo_picker: true, below_hpp: false };

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { calls: [], headers: [], items: [], removed: false, finalizationError: "", pool: true, shRows: [], flags: {}, flagError: "", promoReads: 0, prior: null, campaign: null });
});

function form(lines: [string, number][], extra: Record<string, string> = {}, forged: Record<string, unknown> = {}) {
  const data = new FormData();
  Object.entries({
    branchId: "branch", customerId: "customer", metode: "Tunai", bayar: "500000", operationalShiftId: "shift", checkout_key: "sh-actions", ...extra,
    cart: JSON.stringify(lines.map(([item_id, qty]) => ({ item_id, nama: "Wrong caller name", qty, harga: 1, satuan: "PCS", promo_discount: 999999, officialPrice: 1, ...forged }))),
  }).forEach(([k, v]) => data.set(k, v));
  return data;
}
const run = (data: FormData) => checkoutKasir(data).then(() => "", e => decodeURIComponent((e as Error).message));
const claimKeys = ["promo_claim_id", "promo_sets", "promo_syarat_units", "promo_hasil_units", "promo_floor_waiver"];
const shape = (i: Record<string, unknown>) => [i.item_id, i.qty, i.promo_id, i.promo_discount, i.source_position];

// ---------------------------------------------------------------------------------------------------- no-op guarantees
it("FLAGS OFF (no active syarat_hasil promo): Bolt pool cart is priced and written exactly as before - no claim columns, no pick columns, no RPC for flags", async () => {
  const outcome = await run(form([["item", 1], ["other", 1]]));
  expect(outcome).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ subtotal: 40000, total: 38000, discount: 2000 });
  expect(Object.keys(state.headers[0]).filter(k => k.startsWith("promo_"))).toEqual([]);
  expect(state.items.map(shape)).toEqual([["item", 1, "pool", 1000, 0], ["other", 1, "pool", 1000, 1]]);
  expect(state.items.map(i => i.quantity_pool_claim)).toEqual([true, true]);
  for (const i of state.items) for (const k of claimKeys) expect(i).not.toHaveProperty(k);
  expect(state.calls.map(c => c.name)).not.toContain("promo_release_enabled");
  expect(state.calls.filter(c => c.name === "cashier_post_stock_atomic")).toHaveLength(1);
});
it("a syarat_hasil promo exists but the release flag is OFF: identical to flags off (the flag RPC is consulted, nothing else changes)", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = { syarat_hasil: false };
  const outcome = await run(form([["item", 2], ["anc", 1]]));
  expect(outcome).toContain("/struk/sale");
  expect(state.items.map(i => i.promo_id)).toEqual(["pool", null]);
  expect(Object.keys(state.headers[0]).filter(k => k.startsWith("promo_"))).toEqual([]);
  for (const i of state.items) for (const k of claimKeys) expect(i).not.toHaveProperty(k);
});
it("flag RPC missing in the database (app deployed before the migration): treated as OFF, checkout unaffected", async () => {
  state.shRows = [shPromo(3000)];
  state.flagError = "42883";
  expect(await run(form([["item", 1], ["other", 1]]))).toContain("/struk/sale");
  expect(state.items.map(i => i.promo_id)).toEqual(["pool", "pool"]);
});
it("flag RPC failing for any other reason fails closed (no sale is written)", async () => {
  state.shRows = [shPromo(3000)];
  state.flagError = "XX000";
  expect(await run(form([["item", 1], ["other", 1]]))).toContain("Status rilis promo");
  expect(state.headers).toHaveLength(0);
});
it("flags ON, Bolt-only cart (no reward item in the cart): identical to the legacy result, no claim or pick columns", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  const outcome = await run(form([["item", 1], ["other", 1]]));
  expect(outcome).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ subtotal: 40000, total: 38000, discount: 2000 });
  expect(Object.keys(state.headers[0]).filter(k => k.startsWith("promo_"))).toEqual([]);
  expect(state.items.map(shape)).toEqual([["item", 1, "pool", 1000, 0], ["other", 1, "pool", 1000, 1]]);
  expect(state.items.map(i => i.quantity_pool_claim)).toEqual([true, true]);
  for (const i of state.items) for (const k of claimKeys) expect(i).not.toHaveProperty(k);
});

// ---------------------------------------------------------------------------------------------------- the feature
it("flags ON, syarat-hasil saves MORE than the Bolt pool: Bolt Ikan x2 syarat line + ANC reward line carry the claim; the pool is not applied", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  const outcome = await run(form([["item", 2], ["anc", 1]]));
  expect(outcome).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ subtotal: 55000, total: 52000, discount: 3000, promo_pick_mode: "auto" });
  expect(state.headers[0].promo_selection).toMatchObject({ version: 1, mode: "auto", strategy: "syarat_hasil", applied: [{ promo_id: "sh1", discount: 3000, kind: "syarat_hasil" }], by_user: "actor" });
  expect(state.items.map(shape)).toEqual([["item", 2, null, 0, 0], ["anc", 1, "sh1", 3000, 1]]);
  expect(state.items.map(i => [i.promo_claim_id, i.promo_sets, i.promo_syarat_units, i.promo_hasil_units, i.promo_floor_waiver])).toEqual([["sh1", 1, 2, 0, false], ["sh1", 1, 0, 1, false]]);
  expect(state.items.map(i => i.quantity_pool_claim)).toEqual([false, false]);
  expect(state.calls.filter(c => c.name === "cashier_post_stock_atomic")).toHaveLength(1); // the existing atomic finalize path, once
});
it("flags ON, the Bolt pool saves more (2000 > 1000): the legacy result stands, nothing is claimed, no pick columns", async () => {
  state.shRows = [shPromo(1000)];
  state.flags = ON;
  expect(await run(form([["item", 2], ["anc", 1]]))).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ total: 53000 });
  expect(Object.keys(state.headers[0]).filter(k => k.startsWith("promo_"))).toEqual([]);
  expect(state.items.map(shape)).toEqual([["item", 2, "pool", 2000, 0], ["anc", 1, null, 0, 1]]);
  for (const i of state.items) for (const k of claimKeys) expect(i).not.toHaveProperty(k);
});
it("flags ON: claimed units are split from the plain remainder, source positions are contiguous, the remainder is priced by the legacy engine", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  // Bolt x4: 2 units are syarat units, the other 2 form a plain line that still earns the pool (2 Bolt units = 38000)
  expect(await run(form([["item", 4], ["anc", 1]]))).toContain("/struk/sale");
  expect(state.items.map(shape)).toEqual([["item", 2, null, 0, 0], ["item", 2, "pool", 2000, 1], ["anc", 1, "sh1", 3000, 2]]);
  expect(state.items.map(i => i.promo_claim_id ?? null)).toEqual(["sh1", null, "sh1"]);
  expect(state.items.map(i => i.quantity_pool_claim)).toEqual([false, true, false]);
  expect(state.headers[0]).toMatchObject({ subtotal: 95000, total: 90000 });
});
it("client-forged evidence is ignored: promo_discount, officialPrice, official_price and sh_claim in the cart JSON change nothing", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  const forged = { official_price: 1, sh_claim: { promo_id: "sh1", sets: 9, syarat_units: 9, hasil_units: 9, waiver: true }, promo_claim_id: "sh1", item_discount_value: 0 };
  expect(await run(form([["item", 2], ["anc", 1]], {}, forged))).toContain("/struk/sale");
  expect(state.items.map(i => [i.promo_claim_id, i.promo_sets, i.promo_syarat_units, i.promo_hasil_units, i.promo_floor_waiver])).toEqual([["sh1", 1, 2, 0, false], ["sh1", 1, 0, 1, false]]);
  // and with the flag off the forged claim never reaches the insert
  state.items = []; state.headers = []; state.flags = {}; state.prior = null;
  expect(await run(form([["item", 2], ["anc", 1]], {}, forged))).toContain("/struk/sale");
  for (const i of state.items) for (const k of claimKeys) expect(i).not.toHaveProperty(k);
});
it("a manual line discount keeps the line out of the promo (the database refuses a claim on it)", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  const data = form([["item", 2], ["anc", 1]]);
  const cart = JSON.parse(String(data.get("cart"))); cart[0].item_discount_type = "nominal"; cart[0].item_discount_value = 500; data.set("cart", JSON.stringify(cart));
  expect(await run(data)).toContain("/struk/sale");
  for (const i of state.items) for (const k of claimKeys) expect(i).not.toHaveProperty(k);
});

// ---------------------------------------------------------------------------------------------------- cashier "tanpa promo"
it("cashier chose 'tanpa promo' (picker released): no promo at all, the pick is recorded", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  expect(await run(form([["item", 2], ["anc", 1]], { promoPick: "none" }))).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ subtotal: 55000, total: 55000, discount: 0, promo_pick_mode: "tanpa" });
  expect(state.items.map(i => [i.promo_id, i.promo_discount, i.quantity_pool_claim])).toEqual([[null, 0, false], [null, 0, false]]);
  for (const i of state.items) for (const k of claimKeys) expect(i).not.toHaveProperty(k);
});
it("'tanpa promo' while the picker flag is OFF is refused before anything is written", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = { syarat_hasil: true, promo_picker: false, below_hpp: false };
  const outcome = await run(form([["item", 2], ["anc", 1]], { promoPick: "none" }));
  expect(outcome).toContain("Fitur ganti promo belum aktif");
  expect(state.headers).toHaveLength(0);
});
it("an unknown promoPick value is refused", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  expect(await run(form([["item", 2], ["anc", 1]], { promoPick: "sh1" }))).toContain("Pilihan promo tidak dikenal");
  expect(state.headers).toHaveLength(0);
});

// ---------------------------------------------------------------------------------------------------- DB refusal
it("a database refusal (PROMO_SH_*) rolls the sale back and tells the cashier in Indonesian", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  state.finalizationError = "PROMO_SH_NILAI: whole-cart value 100 is below 1 x 500";
  const outcome = await run(form([["item", 2], ["anc", 1]]));
  expect(outcome).not.toContain("/struk/");
  expect(outcome).toContain("Promo");
  expect(outcome).not.toContain("PROMO_SH_");
  expect(state.removed).toBe(true);
});
it("a campaign code that forces a promo switches syarat-hasil off for that sale (the code wins; legacy result, no claims)", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  state.campaign = { code: "KAMPANYE1", voucher_code: null, promo_id: "pool", is_active: true };
  expect(await run(form([["item", 2], ["anc", 1]], { voucherCode: "KAMPANYE1" }))).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ total: 53000, campaign_code: "KAMPANYE1" });
  expect(Object.keys(state.headers[0]).filter(k => k.startsWith("promo_"))).toEqual([]);
  expect(state.items.map(i => i.promo_id)).toEqual(["pool", null]);
  for (const i of state.items) for (const k of claimKeys) expect(i).not.toHaveProperty(k);
});
