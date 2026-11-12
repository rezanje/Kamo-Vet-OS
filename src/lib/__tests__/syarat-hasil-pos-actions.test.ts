import { beforeEach, expect, it, vi } from "vitest";

// STAGE 4: POS back office (checkoutSale) x promo "syarat -> hasil". Same mock style as syarat-hasil-checkout-actions.test.ts / quantity-pool-checkout-actions.test.ts.
const PRICE: Record<string, number> = { item: 20000, other: 20000, anc: 15000 };
const COST: Record<string, number> = { item: 17040, other: 17040, anc: 10000 };
const state = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown }[], headers: [] as Record<string, unknown>[], items: [] as Record<string, unknown>[], removed: false,
  finalizationError: "", pool: true, shRows: [] as Record<string, unknown>[], flags: {} as Record<string, boolean>, prior: null as null | Record<string, unknown>,
  insertError: null as null | { table: string; message: string }, stock: true, campaign: null as null | Record<string, unknown>,
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
// Skenario di file ini dijalankan sebagai Owner/Admin: izin diskon manual (12 Nov 2026) diuji terpisah di manual-discount.test.ts.
vi.mock("@/lib/manual-discount", async (original) => ({ ...(await original<typeof import("@/lib/manual-discount")>()), manualDiscountAllowed: async () => true }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/kode-kampanye", async original => ({ ...await original<typeof import("@/lib/kode-kampanye")>(), bacaKodeKampanye: async () => state.campaign }));
vi.mock("@/lib/penjual", () => ({ penjualValid: async () => true }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "POS-SH-BO" }) }));
vi.mock("@/lib/posting", () => ({ postJournal: async () => {} }));
vi.mock("@/lib/quest-hook", () => ({ processQuestProgress: async () => {} }));
vi.mock("@/lib/inventory", () => ({ stockOut: vi.fn(async () => ({ cost: 17040 })) }));
vi.mock("@/lib/harga-cabang", () => ({ loadHargaCabang: async () => new Map(), hargaCabang: (_m: unknown, _id: string, _unit: string, price: number) => price, applyHargaCabang: (options: unknown) => options }));
vi.mock("@/lib/promo-hitung", async original => ({ ...await original<typeof import("@/lib/promo-hitung")>(), loadPromoAktif: async () => (state.pool ? [{
  id: "pool", name: "Fictional pool", itemIds: ["item", "other"], unit: "PCS", minQty: 2, maxQty: null, kelipatan: true, autoApply: true, discountType: "nominal", discountValue: 1, discountMode: "quantity_pool",
  quantityPool: { version: 1, unit: "PCS", normal_price: 20000, tiers: [{ qty: 6, total: 110000 }, { qty: 2, total: 38000 }] },
}] : []) }));
vi.mock("@/lib/satuan", async original => ({ ...await original<typeof import("@/lib/satuan")>(), loadUnitOptions: async () => new Map(Object.keys(PRICE).map(id => [id, [{ unit: "PCS", factor: 1, sell_price: PRICE[id], buy_price: 0 }]])) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (name: string, values: Record<string, unknown>) => {
    state.calls.push({ name, args: values });
    if (name === "promo_release_enabled") return { data: state.flags[String(values.p_flag)] === true, error: null };
    if (name === "refresh_customer_spending") return { data: true, error: null };
    if (!["finalize_pos_sale", "pos_post_promo_atomic", "quantity_pool_post_backoffice_atomic"].includes(name)) throw Error(`Unexpected RPC ${name}`);
    if (state.finalizationError) return { data: null, error: { message: state.finalizationError } };
    return { data: { sale_id: values.p_sale_id, journal_id: "journal", finalized: true, ...(name !== "finalize_pos_sale" ? { checked: true } : {}) }, error: null };
  },
  from(table: string) {
    let lookup = false;
    const data: unknown = table === "items" ? Object.keys(PRICE).map(id => ({ id, code: id, nama: id, name: id, unit: "PCS", item_type: "Persediaan", sell_price: PRICE[id], buy_price: 0, min_sell_qty: 1, is_active: true, tindakan_kategori: null }))
      : table === "stock_layers" ? Object.keys(PRICE).map(id => ({ id: `layer:${id}`, item_id: id, qty_left: 100, unit_cost: COST[id], exp_date: null, tanggal: "2026-10-15", created_at: "2026-10-15T00:00:00Z" }))
        : table === "promos" ? state.shRows : [];
    const single = () => state.insertError && state.insertError.table === table && !lookup ? { data: null, error: { message: state.insertError.message } }
      : { data: table === "sales" && lookup ? state.prior : table === "cashier_shifts" ? { id: "shift", branch_id: "branch" } : table === "customers" ? { points: 0, total_spending: 0, category_id: null, customer_categories: null }
        : table === "warehouses" ? (state.stock ? { id: "warehouse" } : null) : { id: table === "sales" ? "sale" : "line" }, error: null };
    const query = {
      select: (fields: string) => { lookup = typeof fields === "string" && fields.includes("checkout_fingerprint"); return query; }, eq: () => query, in: () => query, gt: () => query, lte: () => query, not: () => query, order: () => query, range: () => query, limit: () => query,
      insert: (value: Record<string, unknown>) => {
        if (table === "sales") { state.headers.push(value); if (state.insertError?.table !== "sales") state.prior = { id: "sale", no_struk: "POS-SH-BO", checkout_fingerprint: value.checkout_fingerprint, payments_finalized_at: null }; }
        if (table === "sale_items") state.items.push({ id: `line${state.items.length}`, ...value });
        return query;
      },
      update: () => query, delete: () => { if (table === "sales") { state.removed = true; state.prior = null; } return query; },
      single: async () => single(), maybeSingle: async () => single(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, count: Array.isArray(data) ? data.length : 0, error: null }).then(resolve),
    };
    return query;
  },
}) }));
import { checkoutSale } from "@/app/(app)/pos/transaksi/actions";

const RULE = (value: number, allowed = false) => ({
  discount_mode: "syarat_hasil", suggest: "x",
  syarat_hasil: {
    version: 1, repeat: true,
    syarat: [{ kind: "qty", min: 2, items: [{ item_id: "item", unit: "PCS" }, { item_id: "other", unit: "PCS" }] }],
    hasil: { kind: "barang", items: [{ item_id: "anc", unit: "PCS" }], discount: { type: "nominal", value } },
    below_hpp: allowed ? { allowed: true, reason: "barang mendekati expired", ack_by: "owner", ack_at: "2026-11-01T00:00:00Z" } : { allowed: false },
  },
});
const shPromo = (value: number, allowed = false) => ({ id: "sh1", name: "Beli 2 Bolt, ANC", rule: RULE(value, allowed), branch_ids: null, valid_from: null, valid_until: null });
const ON = { syarat_hasil: true, promo_picker: true, below_hpp: false };
const claimKeys = ["promo_claim_id", "promo_sets", "promo_syarat_units", "promo_hasil_units", "promo_floor_waiver"];
const rpcNames = () => state.calls.map(c => c.name);

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { calls: [], headers: [], items: [], removed: false, finalizationError: "", pool: true, shRows: [], flags: {}, prior: null, insertError: null, stock: true, campaign: null });
});

function form(lines: [string | null, number][], extra: Record<string, string> = {}, forged: Record<string, unknown> = {}) {
  const data = new FormData();
  Object.entries({
    branchId: "branch", customerId: "customer", metode: "Tunai", bayar: "500000", checkout_key: "sh-pos",
    cart: JSON.stringify(lines.map(([item_id, qty]) => ({ item_id, nama: item_id ?? "Ketikan manual", qty, harga: item_id ? 1 : 3000, satuan: "PCS", target_species: "Universal", promo_discount: 999999, ...forged }))), ...extra,
  }).forEach(([k, v]) => data.set(k, v));
  return data;
}
const run = (data: FormData) => checkoutSale(data).then(() => "", e => decodeURIComponent((e as Error).message));

// ---------------------------------------------------------------------------------------------------- flags OFF = identical
it("FLAGS OFF (no syarat_hasil promo): the Bolt-pool cart posts exactly as before - quantity_pool_post_backoffice_atomic, no claim/pick columns, no flag RPC", async () => {
  expect(await run(form([["item", 1], ["other", 1]]))).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ subtotal: 40000, total: 38000, discount: 2000 });
  expect(Object.keys(state.headers[0]).filter(k => k.startsWith("promo_"))).toEqual([]);
  expect(state.items.map(i => [i.item_id, i.qty, i.promo_id, i.promo_discount, i.source_position])).toEqual([["item", 1, "pool", 1000, 0], ["other", 1, "pool", 1000, 1]]);
  for (const i of state.items) for (const k of claimKeys) expect(i).not.toHaveProperty(k);
  expect(rpcNames()).toContain("quantity_pool_post_backoffice_atomic");
  expect(rpcNames()).not.toContain("pos_post_promo_atomic");
  expect(rpcNames()).not.toContain("promo_release_enabled");
});
it("a syarat_hasil promo exists but its release flag is OFF: identical to flags off", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = { syarat_hasil: false };
  expect(await run(form([["item", 2], ["anc", 1]]))).toContain("/struk/sale");
  expect(state.items.map(i => i.promo_id)).toEqual(["pool", null]);
  expect(Object.keys(state.headers[0]).filter(k => k.startsWith("promo_"))).toEqual([]);
  for (const i of state.items) for (const k of claimKeys) expect(i).not.toHaveProperty(k);
  expect(rpcNames()).not.toContain("pos_post_promo_atomic");
});
it("flags ON but a Bolt-only cart (nothing to claim): identical to the legacy result and the legacy pool posting", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  expect(await run(form([["item", 1], ["other", 1]]))).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ total: 38000, discount: 2000 });
  expect(Object.keys(state.headers[0]).filter(k => k.startsWith("promo_"))).toEqual([]);
  expect(rpcNames()).toContain("quantity_pool_post_backoffice_atomic");
  expect(rpcNames()).not.toContain("pos_post_promo_atomic");
  for (const i of state.items) for (const k of claimKeys) expect(i).not.toHaveProperty(k);
});

// ---------------------------------------------------------------------------------------------------- the feature
it("flags ON, syarat-hasil saves more than the pool: claim lines, header promo columns, and the sale is posted by pos_post_promo_atomic (ONE call, no finalize_pos_sale)", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  expect(await run(form([["item", 2], ["anc", 1]]))).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ subtotal: 55000, total: 52000, discount: 3000, promo_pick_mode: "auto" });
  expect(state.headers[0].promo_selection).toMatchObject({ version: 1, mode: "auto", strategy: "syarat_hasil", applied: [{ promo_id: "sh1", discount: 3000 }] });
  expect(state.items.map(i => [i.item_id, i.qty, i.promo_id, i.promo_discount, i.source_position])).toEqual([["item", 2, null, 0, 0], ["anc", 1, "sh1", 3000, 1]]);
  expect(state.items.map(i => [i.promo_claim_id, i.promo_sets, i.promo_syarat_units, i.promo_hasil_units, i.promo_floor_waiver])).toEqual([["sh1", 1, 2, 0, false], ["sh1", 1, 0, 1, false]]);
  expect(state.items.map(i => i.quantity_pool_claim)).toEqual([false, false]);
  expect(rpcNames().filter(n => n === "pos_post_promo_atomic")).toHaveLength(1);
  expect(rpcNames()).not.toContain("finalize_pos_sale");
  expect(rpcNames()).not.toContain("quantity_pool_post_backoffice_atomic");
  expect(state.calls.find(c => c.name === "pos_post_promo_atomic")!.args).toEqual({ p_sale_id: "sale", p_warehouse_id: "warehouse" });
});
it("flags ON: a claimed line is split from the plain remainder, which the pool still prices (Bolt x4 + ANC)", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  expect(await run(form([["item", 4], ["anc", 1]]))).toContain("/struk/sale");
  expect(state.items.map(i => [i.item_id, i.qty, i.promo_id, i.promo_discount, i.source_position])).toEqual([["item", 2, null, 0, 0], ["item", 2, "pool", 2000, 1], ["anc", 1, "sh1", 3000, 2]]);
  expect(state.items.map(i => i.quantity_pool_claim)).toEqual([false, true, false]);
  expect(state.headers[0]).toMatchObject({ subtotal: 95000, total: 90000 });
});
it("flags ON, the pool saves more: the legacy result and the legacy pool posting stand", async () => {
  state.shRows = [shPromo(1000)];
  state.flags = ON;
  expect(await run(form([["item", 2], ["anc", 1]]))).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ total: 53000 });
  expect(rpcNames()).toContain("quantity_pool_post_backoffice_atomic");
  for (const i of state.items) for (const k of claimKeys) expect(i).not.toHaveProperty(k);
});
it("client-forged evidence (sh_claim, official_price, promo_claim_id, promo_discount) is ignored", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  const forged = { official_price: 1, sh_claim: { promo_id: "sh1", sets: 9, syarat_units: 9, hasil_units: 9, waiver: true }, promo_claim_id: "sh1" };
  expect(await run(form([["item", 2], ["anc", 1]], {}, forged))).toContain("/struk/sale");
  expect(state.items.map(i => [i.promo_claim_id, i.promo_sets, i.promo_syarat_units, i.promo_hasil_units, i.promo_floor_waiver])).toEqual([["sh1", 1, 2, 0, false], ["sh1", 1, 0, 1, false]]);
});
it("forged claim evidence on lines the composer does NOT claim never reaches sale_items (flags OFF and flags ON with nothing to claim)", async () => {
  const forged = { sh_claim: { promo_id: "sh1", sets: 9, syarat_units: 9, hasil_units: 9, waiver: true }, official_price: 1 };
  expect(await run(form([["item", 1], ["other", 1]], {}, forged))).toContain("/struk/sale"); // flags OFF
  for (const i of state.items) for (const k of claimKeys) expect(i).not.toHaveProperty(k);
  state.items = []; state.headers = []; state.prior = null;
  state.shRows = [shPromo(3000)]; state.flags = ON;
  expect(await run(form([["item", 1], ["other", 1]], {}, forged))).toContain("/struk/sale"); // flags ON, Bolt-only: no claim
  for (const i of state.items) for (const k of claimKeys) expect(i).not.toHaveProperty(k);
});
it("a free-text line (no item) in the cart keeps its null item and is never a promo unit", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  expect(await run(form([["item", 2], ["anc", 1], [null, 1]]))).toContain("/struk/sale");
  expect(state.items.map(i => [i.item_id, i.qty, i.promo_id])).toEqual([["item", 2, null], ["anc", 1, "sh1"], [null, 1, null]]);
});
const PICKER_OFF = { syarat_hasil: true, promo_picker: false, below_hpp: false };
const onlyKnownWrites = () => state.calls.filter(c => c.name !== "promo_release_enabled");

// ---------------------------------------------------------------------------------------------------- picker flag OFF: forged picks stay refused
it("promo_picker flag OFF (syarat_hasil ON): every promoPick other than ''/auto is refused with the existing message, nothing written, no posting RPC; auto/'' unchanged", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = PICKER_OFF;
  for (const pick of ["none", "sh1", "pool", "ghost", "x;drop"]) {
    expect(await run(form([["item", 2], ["anc", 1]], { promoPick: pick })), pick).toContain("Fitur ganti promo belum tersedia di POS belakang");
    expect(state.headers, pick).toHaveLength(0);
    expect(onlyKnownWrites(), pick).toEqual([]);
  }
  for (const pick of ["auto", ""]) { Object.assign(state, { headers: [], items: [], prior: null, calls: [] }); expect(await run(form([["item", 2], ["anc", 1]], { promoPick: pick }))).toContain("/pos/struk/sale"); expect(state.headers[0]).toMatchObject({ total: 52000, promo_pick_mode: "auto" }); }
});

// ---------------------------------------------------------------------------------------------------- picker flag ON: the picker (mirror of the cashier)
it("picker ON, 'Tanpa promo' (none): ALL promos incl. the Bolt pool are cancelled, header records mode 'tanpa' (no pick id), lines carry no promo and no claim, pool posting path", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  expect(await run(form([["item", 2], ["anc", 1]], { promoPick: "none" }))).toContain("/pos/struk/sale");
  expect(state.headers[0]).toMatchObject({ subtotal: 55000, total: 55000, discount: 0, promo_pick_mode: "tanpa" });
  expect(state.headers[0]).not.toHaveProperty("promo_pick_id");
  expect(state.headers[0]).not.toHaveProperty("promo_pick_exclusive");
  expect(state.headers[0].promo_selection).toMatchObject({ version: 1, mode: "tanpa", pick: null, exclusive: false, strategy: "none", applied: [], by_user: "actor" });
  expect(state.items.map(i => [i.item_id, i.qty, i.promo_id, i.promo_discount, i.quantity_pool_claim])).toEqual([["item", 2, null, 0, false], ["anc", 1, null, 0, false]]);
  for (const i of state.items) for (const k of claimKeys) expect(i).not.toHaveProperty(k);
  expect(rpcNames()).toContain("quantity_pool_post_backoffice_atomic");
  expect(rpcNames()).not.toContain("pos_post_promo_atomic");
});
it("picker ON, 'Tanpa promo' on a cart with no Bolt item: plain finalize_pos_sale, mode 'tanpa' recorded, full price", async () => {
  state.pool = false; state.shRows = [shPromo(3000)]; state.flags = ON;
  expect(await run(form([["item", 2], ["anc", 1]], { promoPick: "none" }))).toContain("/pos/struk/sale");
  expect(state.headers[0]).toMatchObject({ total: 55000, promo_pick_mode: "tanpa" });
  expect(rpcNames()).toContain("finalize_pos_sale");
});
it("picker ON, exclusive pick of a syarat-hasil promo that LOSES the automatic comparison: that promo is applied alone, the Bolt pool is off, header says pilih + id + exclusive", async () => {
  state.shRows = [shPromo(1000)];            // auto = pool (53000); the cashier insists on the bundle
  state.flags = ON;
  expect(await run(form([["item", 2], ["anc", 1]], { promoPick: "sh1" }))).toContain("/pos/struk/sale");
  expect(state.headers[0]).toMatchObject({ total: 54000, discount: 1000, promo_pick_mode: "pilih", promo_pick_id: "sh1", promo_pick_exclusive: true });
  expect(state.headers[0].promo_selection).toMatchObject({ mode: "pilih", pick: "sh1", exclusive: true, strategy: "syarat_hasil", applied: [{ promo_id: "sh1", discount: 1000 }] });
  expect(state.items.map(i => [i.item_id, i.qty, i.promo_id, i.promo_discount, i.quantity_pool_claim])).toEqual([["item", 2, null, 0, false], ["anc", 1, "sh1", 1000, false]]);
  expect(rpcNames().filter(n => n === "pos_post_promo_atomic")).toHaveLength(1);
});
it("picker ON, exclusive pick of the Bolt pool while the bundle would win: pool alone, no claim columns, header pilih/pool/exclusive", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  expect(await run(form([["item", 2], ["anc", 1]], { promoPick: "pool" }))).toContain("/pos/struk/sale");
  expect(state.headers[0]).toMatchObject({ total: 53000, promo_pick_mode: "pilih", promo_pick_id: "pool", promo_pick_exclusive: true });
  expect(state.items.map(i => [i.item_id, i.promo_id, i.promo_discount, i.quantity_pool_claim])).toEqual([["item", "pool", 2000, true], ["anc", null, 0, false]]);
  for (const i of state.items) for (const k of claimKeys) expect(i).not.toHaveProperty(k);
  expect(rpcNames()).toContain("quantity_pool_post_backoffice_atomic");
});
it("picker ON, auto / empty: unchanged result (bundle wins, mode auto, no pick id)", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  for (const pick of ["auto", ""]) {
    Object.assign(state, { headers: [], items: [], prior: null, calls: [] });
    expect(await run(form([["item", 2], ["anc", 1]], { promoPick: pick }))).toContain("/pos/struk/sale");
    expect(state.headers[0]).toMatchObject({ total: 52000, promo_pick_mode: "auto" });
    expect(state.headers[0]).not.toHaveProperty("promo_pick_id");
  }
});

// ---------------------------------------------------------------------------------------------------- stale / forged picks are REFUSED (never a silent fallback)
it("stale pick: the picked promo no longer applies to the cart -> refused with 'Promo pilihan tidak lagi berlaku', nothing written", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  const out = await run(form([["item", 1], ["other", 1]], { promoPick: "sh1" })); // no ANC reward in the cart: the bundle does not apply
  expect(out).toContain("Promo pilihan tidak lagi berlaku");
  expect(state.headers).toHaveLength(0);
  expect(onlyKnownWrites()).toEqual([]);
});
it("forged pick ids (unknown, malformed, >64 chars, SQL-ish, expired, other-branch promo) are refused and nothing is written", async () => {
  const other = { ...shPromo(3000), id: "sh2", branch_ids: ["elsewhere"] };
  const expired = { ...shPromo(3000), id: "sh3", valid_until: "2026-10-01" };
  state.shRows = [shPromo(3000), other, expired];
  state.flags = ON;
  for (const pick of ["ghost", "sh2", "sh3", "x;drop table sales", "a".repeat(65), "sh1'--", "../etc", "none "]) {
    Object.assign(state, { headers: [], items: [], prior: null, calls: [] });
    const out = await run(form([["item", 2], ["anc", 1]], { promoPick: pick }));
    if (pick === "none ") { expect(out).toContain("/pos/struk/sale"); continue; } // trimmed like the cashier: this is 'none'
    expect(out, pick).toMatch(/Pilihan promo tidak dikenal|Promo pilihan tidak lagi berlaku/);
    expect(state.headers, pick).toHaveLength(0);
    expect(state.items, pick).toHaveLength(0);
    expect(onlyKnownWrites(), pick).toEqual([]);
  }
});
it("a malformed id gets the 'tidak dikenal' message; an unknown but well-formed id gets 'tidak lagi berlaku'", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  expect(await run(form([["item", 2], ["anc", 1]], { promoPick: "x;drop" }))).toContain("Pilihan promo tidak dikenal. Muat ulang halaman.");
  expect(await run(form([["item", 2], ["anc", 1]], { promoPick: "a".repeat(65) }))).toContain("Pilihan promo tidak dikenal. Muat ulang halaman.");
  expect(await run(form([["item", 2], ["anc", 1]], { promoPick: "a".repeat(64) }))).toContain("Promo pilihan tidak lagi berlaku. Muat ulang halaman.");
  expect(await run(form([["item", 2], ["anc", 1]], { promoPick: "ghost" }))).toContain("Promo pilihan tidak lagi berlaku. Muat ulang halaman.");
});
it("a pick of a promo whose reward would sell below FIFO cost (no waiver) is refused with the HPP message, not silently dropped to the pool", async () => {
  state.shRows = [shPromo(6000)];
  state.flags = ON;
  const out = await run(form([["item", 2], ["anc", 1]], { promoPick: "sh1" }));
  expect(out).toContain("hadiah di bawah modal (HPP). Pilih Otomatis atau Tanpa promo.");
  expect(state.headers).toHaveLength(0);
});
it("a campaign code that forces a promo cannot be combined with a pick (picker ON): refused; with picker OFF the old refusal; auto still works", async () => {
  state.shRows = [shPromo(3000)];
  state.campaign = { code: "BOLT26", voucher_id: null, promo_id: "pool", is_active: true, max_uses: null, vouchers: null };
  state.flags = ON;
  for (const pick of ["none", "sh1", "pool"]) {
    expect(await run(form([["item", 2], ["other", 1]], { promoPick: pick, voucherCode: "BOLT26" })), pick).toContain("Pilihan promo tidak bisa dipakai bersama kode kampanye yang memaksa promo tertentu");
    expect(state.headers).toHaveLength(0);
  }
  state.flags = PICKER_OFF;
  expect(await run(form([["item", 2], ["other", 1]], { promoPick: "none", voucherCode: "BOLT26" }))).toContain("belum tersedia");
  state.flags = ON;
  expect(await run(form([["item", 2], ["other", 1]], { promoPick: "auto", voucherCode: "BOLT26" }))).toContain("/pos/struk/sale");
});
it("forged promo_pick_* / promo_selection form fields are never read: the header comes from the server's own composition", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  const forged = { promo_pick_mode: "pilih", promo_pick_id: "ghost", promo_pick_exclusive: "true", promo_selection: "x".repeat(9000) };
  expect(await run(form([["item", 2], ["anc", 1]], { promoPick: "none", ...forged }))).toContain("/pos/struk/sale");
  expect(state.headers[0]).toMatchObject({ promo_pick_mode: "tanpa" });
  expect(state.headers[0]).not.toHaveProperty("promo_pick_id");
  expect(Buffer.byteLength(JSON.stringify(state.headers[0].promo_selection))).toBeLessThan(8192);
  expect(state.headers[0].promo_selection).toMatchObject({ mode: "tanpa", pick: null });
});

// ---------------------------------------------------------------------------------------------------- promoExpect (UX guard, same rule as the cashier)
it("promoExpect: equal to the server saving passes; different / NaN / Infinity / negative are refused with the screen-vs-server message; empty or absent skips the check", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  expect(await run(form([["item", 2], ["anc", 1]], { promoExpect: "3000" }))).toContain("/pos/struk/sale");
  for (const v of ["", undefined]) { Object.assign(state, { headers: [], items: [], prior: null, calls: [] }); expect(await run(form([["item", 2], ["anc", 1]], v === undefined ? {} : { promoExpect: v }))).toContain("/pos/struk/sale"); }
  for (const v of ["2999", "3001", "99999", "abc", "NaN", "Infinity", "-3000", "0"]) {
    Object.assign(state, { headers: [], items: [], prior: null, calls: [] });
    expect(await run(form([["item", 2], ["anc", 1]], { promoExpect: v })), v).toContain("berbeda dengan hitungan server");
    expect(state.headers, v).toHaveLength(0);
  }
});
it("promoExpect with a pick: 'Tanpa promo' expects 0, the picked bundle expects its own saving; the automatic number is refused for a pick (stale screen)", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  expect(await run(form([["item", 2], ["anc", 1]], { promoPick: "none", promoExpect: "0" }))).toContain("/pos/struk/sale");
  Object.assign(state, { headers: [], items: [], prior: null, calls: [] });
  expect(await run(form([["item", 2], ["anc", 1]], { promoPick: "none", promoExpect: "3000" }))).toContain("berbeda dengan hitungan server");
  Object.assign(state, { headers: [], items: [], prior: null, calls: [] });
  expect(await run(form([["item", 2], ["anc", 1]], { promoPick: "pool", promoExpect: "2000" }))).toContain("/pos/struk/sale");
  Object.assign(state, { headers: [], items: [], prior: null, calls: [] });
  expect(await run(form([["item", 2], ["anc", 1]], { promoPick: "pool", promoExpect: "3000" }))).toContain("berbeda dengan hitungan server");
});
it("promoExpect when the server drops a below-cost reward (the POS screen has no cost): the screen's pre-drop number OR the server's number is accepted, anything else is refused", async () => {
  state.shRows = [shPromo(6000)];            // screen shows 6000; the server drops the bundle (reward below FIFO cost) and the pool prices the cart (2000)
  state.flags = ON;
  for (const v of ["6000", "2000"]) { Object.assign(state, { headers: [], items: [], prior: null, calls: [] }); expect(await run(form([["item", 2], ["anc", 1]], { promoExpect: v })), v).toContain("/pos/struk/sale"); expect(state.headers[0]).toMatchObject({ total: 53000 }); }
  Object.assign(state, { headers: [], items: [], prior: null, calls: [] });
  expect(await run(form([["item", 2], ["anc", 1]], { promoExpect: "4000" }))).toContain("berbeda dengan hitungan server");
  expect(state.headers).toHaveLength(0);
});
it("promoExpect with flags OFF is ignored exactly as on main (no definitions: nothing to compare)", async () => {
  expect(await run(form([["item", 1], ["other", 1]], { promoExpect: "99999" }))).toContain("/pos/struk/sale");
});

it("L1: with NO syarat-hasil definitions a non-auto promoPick is refused (never ignored): flags OFF -> the existing message; flags ON with only an unparsable active row -> 'tidak dapat dipakai'; nothing is written; auto/empty are untouched", async () => {
  const broken = { id: "broken", name: "Rusak", rule: { discount_mode: "syarat_hasil", syarat_hasil: { version: 1 } }, branch_ids: null, valid_from: null, valid_until: null };
  for (const [rows, flags, message] of [[[], {}, "belum tersedia"], [[broken], ON, "Pilihan promo tidak dapat dipakai: tidak ada promo yang bisa dipilih untuk transaksi ini. Muat ulang halaman."], [[broken], PICKER_OFF, "belum tersedia"]] as const) {
    Object.assign(state, { shRows: rows, flags, headers: [], items: [], prior: null, calls: [] });
    for (const pick of ["none", "sh1", "ghost"]) {
      expect(await run(form([["item", 2], ["anc", 1]], { promoPick: pick })), pick).toContain(message);
      expect(state.headers).toHaveLength(0);
      expect(state.calls.filter(c => c.name !== "promo_release_enabled")).toEqual([]);
    }
    for (const pick of ["auto", ""]) { state.headers = []; state.items = []; state.prior = null; state.calls = []; expect(await run(form([["item", 2], ["anc", 1]], { promoPick: pick }))).toContain("/pos/struk/sale"); expect(state.headers).toHaveLength(1); }
  }
});
it("DB refusal of a picked sale (PROMO_SH_PICK from the finalizer) rolls the sale back with an Indonesian message", async () => {
  state.shRows = [shPromo(1000)]; state.flags = ON;
  state.finalizationError = "PROMO_SH_PICK: exclusive pick but another promo is on a line";
  const out = await run(form([["item", 2], ["anc", 1]], { promoPick: "sh1" }));
  expect(out).toContain("Promo bundling ditolak"); expect(out).not.toContain("PROMO_SH_");
  expect(state.removed).toBe(true);
});

// ---------------------------------------------------------------------------------------------------- below-HPP
it("HPP guard: a reward below FIFO cost without an Owner waiver is dropped (note kept in promo_selection) and the pool prices the cart", async () => {
  state.shRows = [shPromo(6000)];
  state.flags = ON;
  expect(await run(form([["item", 2], ["anc", 1]]))).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ total: 53000, promo_pick_mode: "auto" });
  expect(state.headers[0].promo_selection).toMatchObject({ dropped: [{ promo_id: "sh1", reason: "below_hpp" }] });
  expect(state.items.map(i => i.promo_id)).toEqual(["pool", null]);
  for (const i of state.items) for (const k of claimKeys) expect(i).not.toHaveProperty(k);
  expect(rpcNames()).toContain("quantity_pool_post_backoffice_atomic");
});
it("waiver: Owner waiver + below_hpp released -> pure reward line with promo_floor_waiver, posted by pos_post_promo_atomic, no HPP confirmation box", async () => {
  state.shRows = [shPromo(6000, true)];
  state.flags = { ...ON, below_hpp: true };
  expect(await run(form([["item", 2], ["anc", 2]]))).toContain("/struk/sale");
  const anc = state.items.filter(i => i.item_id === "anc");
  expect(anc[0]).toMatchObject({ qty: 1, promo_syarat_units: 0, promo_hasil_units: 1, promo_floor_waiver: true, promo_discount: 6000 });
  expect(anc[1]).not.toHaveProperty("promo_claim_id");
  expect(rpcNames()).toContain("pos_post_promo_atomic");
});
it("waiver: a receipt-level discount on a below-cost waiver sale is refused (the DB floor does not exist on this path, the app enforces the same rule)", async () => {
  state.shRows = [shPromo(6000, true)];
  state.flags = { ...ON, below_hpp: true };
  const out = await run(form([["item", 2], ["anc", 1]], { discount: "1000" }));
  expect(out).toMatch(/voucher.*poin.*diskon total/i);
  expect(state.headers).toHaveLength(0);
});
it("no warehouse (stock cannot be quoted/posted): a claimed cart is refused with the warehouse message, nothing is written", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  state.stock = false;
  expect(await run(form([["item", 2], ["anc", 1]]))).toMatch(/gudang/i);
  expect(state.headers).toHaveLength(0);
});

// ---------------------------------------------------------------------------------------------------- DB refusals
it("a finalization refusal (PROMO_SH_*) from pos_post_promo_atomic rolls the sale back with an Indonesian message", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  state.finalizationError = "PROMO_SH_NILAI: whole-cart value 100 is below 1 x 500";
  const out = await run(form([["item", 2], ["anc", 1]]));
  expect(out).toContain("Promo bundling ditolak");
  expect(out).not.toContain("PROMO_SH_");
  expect(state.removed).toBe(true);
});
it("the plain finalize_pos_sale path (no claim, no pool) translates a PROMO_SH_* refusal too", async () => {
  state.pool = false;
  state.finalizationError = "PROMO_SH_PICK: cashier chose no promo but lines carry one";
  const out = await run(form([["item", 1]]));
  expect(out).toContain("Promo bundling ditolak");
  expect(out).not.toContain("PROMO_SH");
  expect(rpcNames()).toContain("finalize_pos_sale");
});
it("insert-time refusals (header PROMO_SH_RELEASE, line PROMO_SH_CLAIM) are Indonesian too", async () => {
  state.shRows = [shPromo(3000)];
  state.flags = ON;
  state.insertError = { table: "sales", message: "PROMO_SH_RELEASE: syarat_hasil is not released" };
  const header = await run(form([["item", 2], ["anc", 1]]));
  expect(header).toContain("Promo bundling ditolak");
  expect(header).not.toContain("PROMO_SH");
  state.insertError = { table: "sale_items", message: "PROMO_SH_CLAIM: a manual line discount cannot take part in a promo claim" };
  state.headers = []; state.items = []; state.prior = null; state.removed = false;
  const line = await run(form([["item", 2], ["anc", 1]]));
  expect(line).toContain("diskon manual");
  expect(state.removed).toBe(true);
});
