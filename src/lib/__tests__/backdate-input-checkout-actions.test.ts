import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ headers: [] as Record<string, unknown>[], items: [] as Record<string, unknown>[], finalized: [] as string[], removed: false, finalizationError: "", confirmation: true, stock: false, stockCost: 34567, pointsWrites: 0, prior: null as null | Record<string, unknown>, lostResponse: false, tierUnavailable: false, allowed: false, defaultDiscount: 0, authorized: [] as Record<string, unknown>[], periodClosed: "", promos: [] as Record<string, unknown>[], authorizeError: "", numbering: [] as string[], periods: [] as string[] }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
// Izin diskon manual dibaca lewat RPC manual_discount_allowed (diatur state.allowed).
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async (_c: unknown, tanggal: string) => { state.periods.push(tanggal); return state.periodClosed && tanggal === state.periodClosed ? "Periode akuntansi ditutup" : null; } }));
vi.mock("@/lib/penjual", () => ({ penjualValid: async () => true }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async (_c: unknown, _j: string, tanggal: string) => { state.numbering.push(tanggal); return { nomor: "POS-SPLIT-TEST" }; } }));
vi.mock("@/lib/posting", () => ({ postJournal: async () => {} }));
vi.mock("@/lib/quest-hook", () => ({ processQuestProgress: async () => {} }));
vi.mock("@/lib/inventory", () => ({ stockOut: async () => ({ cost: 34567 }) }));
vi.mock("@/lib/harga-cabang", () => ({ loadHargaCabang: async () => new Map(), hargaCabang: (_map: unknown, _id: string, _unit: string, price: number) => price, applyHargaCabang: (options: unknown) => options }));
vi.mock("@/lib/promo-hitung", async original => ({ ...await original<typeof import("@/lib/promo-hitung")>(), loadPromoAktif: async () => state.promos }));
vi.mock("@/lib/satuan", async original => ({ ...await original<typeof import("@/lib/satuan")>(), loadUnitOptions: async () => new Map([["item", [{ unit: "pcs", factor: 1, sell_price: 100000, buy_price: 0 }]]]) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (name: string, values: { p_sale_id: string }) => {
    if (name === "manual_discount_allowed") return { data: state.allowed, error: null };
    if (name === "pos_sale_backdate_authorize") { state.authorized.push(values as unknown as Record<string, unknown>); return state.authorizeError ? { data: null, error: { message: state.authorizeError } } : { data: { authorized: true }, error: null }; }
    if (name === "refresh_customer_spending") { if(state.tierUnavailable) throw Error("derived statistics unavailable"); return {data:true,error:null}; }
    if (name !== "finalize_pos_sale" && name !== "cashier_post_stock_atomic") throw Error(`Unexpected RPC ${name}`);
    if (state.lostResponse) {
      state.prior = { id: "sale", no_struk: "POS-SPLIT-TEST", checkout_fingerprint: state.headers[0]?.checkout_fingerprint, payments_finalized_at: "2026-10-15T08:00:00Z" };
      return { data: null, error: { message: "Connection lost after commit" } };
    }
    if (state.finalizationError) return { data: null, error: { message: state.finalizationError } };
    state.finalized.push(values.p_sale_id);
    if (name === "cashier_post_stock_atomic") state.items.forEach(item => { item.hpp = state.stockCost; });
    if(state.confirmation && state.prior)state.prior.payments_finalized_at="2026-10-15T08:00:00Z";
    return { data: state.confirmation ? { sale_id: values.p_sale_id, journal_id: "journal", finalized: true, ...(name === "cashier_post_stock_atomic" ? { checked: true } : {}) } : null, error: null };
  },
  from(table: string) {
    let lookup = false;
    let lineUpdate: Record<string, unknown> | null = null;
    let data: unknown = table === "items" ? [{ id: "item", nama: "Pakan", name: "Pakan", unit: "pcs", item_type: state.stock ? "Persediaan" : "Jasa", sell_price: 100000, buy_price: 30000, min_sell_qty: 1, is_active: true, default_discount: state.defaultDiscount }]
      : table === "stock_layers" && state.stock ? [{ id: "layer", item_id: "item", qty_left: 1, unit_cost: state.stockCost, exp_date: null, tanggal: "2026-10-15", created_at: "2026-10-15T00:00:00Z" }] : [];
    const single = () => ({ data: table === "sales" && lookup ? state.prior : table === "cashier_shifts" ? { id: "shift", branch_id: "branch" }
      : table === "customers" ? { points: 0, total_spending: 0, category_id: null, customer_categories: null }
        : table === "warehouses" ? (state.stock ? { id: "warehouse" } : null) : { id: table === "sales" ? "sale" : "line" }, error: null });
    const query = {
      select: (fields: string) => { lookup = fields.includes("checkout_fingerprint"); return query; }, eq: (key: string, value: unknown) => { if (table === "sale_items" && key === "id" && lineUpdate) state.items.filter(item => item.id === value).forEach(item => Object.assign(item, lineUpdate)); return query; }, in: () => query, gt: () => query, lte: () => query, not: () => query, order: () => query, range: () => query, limit: () => query,
      insert: (value: Record<string, unknown>) => { if (table === "sales") { state.headers.push(value); data = value; state.prior = { id: "sale", no_struk: "POS-SPLIT-TEST", checkout_fingerprint: value.checkout_fingerprint, payments_finalized_at: null }; } if (table === "sale_items") state.items.push({ id: "line", ...value }); if (table === "point_ledger") state.pointsWrites++; return query; },
      update: (value: Record<string, unknown>) => { lineUpdate = value; return query; }, delete: () => { if (table === "sales") { state.removed = true; state.prior = null; } return query; },
      single: async () => single(), maybeSingle: async () => single(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, count: Array.isArray(data) ? data.length : 0, error: null }).then(resolve),
    };
    return query;
  },
}) }));
import { checkoutKasir } from "@/app/kasir/checkout";
import { checkoutSale } from "@/app/(app)/pos/transaksi/actions";

import { geserHari, hariIniWIB } from "@/lib/tanggal";

beforeEach(() => {
  state.headers = []; state.items = []; state.finalized = []; state.removed = false; state.finalizationError = ""; state.confirmation = true; state.stock = false;
  state.stockCost = 34567; state.pointsWrites = 0; state.prior = null; state.lostResponse = false; state.tierUnavailable = false; state.allowed = false; state.defaultDiscount = 0;
  state.authorized = []; state.authorizeError = ""; state.numbering = []; state.periods = []; state.periodClosed = ""; state.promos = [];
});

const HARI_INI = hariIniWIB();
const KEMARIN = geserHari(HARI_INI, -1);
function tunai(extra: Record<string, string> = {}) {
  const data = new FormData();
  Object.entries({ branchId: "branch", customerId: "customer", salespersonId: "seller", metode: "Tunai", bayar: "100000", operationalShiftId: "shift", checkout_key: "draft-mundur",
    cart: JSON.stringify([{ item_id: "item", nama: "Pakan", qty: 1, harga: 100000, target_species: "Universal", satuan: "pcs" }]), ...extra }).forEach(([key, value]) => data.set(key, value));
  return data;
}
const run = (action: (data: FormData) => Promise<unknown>, data: FormData) => action(data).then(() => "unexpected success", (error: Error) => error.message);
const mundur = (extra: Record<string, string> = {}) => tunai({ tanggal_pembukuan: KEMARIN, alasan_tanggal: "Barang lupa diinput kemarin", ...extra });
const BOTH = [["cashier", checkoutKasir], ["backoffice", checkoutSale]] as const;

it.each(BOTH)("%s: tanpa tanggal, jalur biasa persis seperti sebelumnya (tanpa izin-pakai, tanpa created_at, nomor hari ini)", async (_l, action) => {
  expect(await run(action, tunai())).toContain("/struk/sale");
  expect(state.authorized).toHaveLength(0);
  expect(state.headers[0]).not.toHaveProperty("created_at");
  expect(state.numbering).toEqual([HARI_INI]);
});

it.each(BOTH)("%s: tanggal hari ini yang terkirim = jalur biasa", async (_l, action) => {
  expect(await run(action, tunai({ tanggal_pembukuan: HARI_INI }))).toContain("/struk/sale");
  expect(state.authorized).toHaveLength(0);
  expect(state.headers[0]).not.toHaveProperty("created_at");
});

it.each(BOTH)("%s: tanggal kemarin + alasan: izin-pakai dipanggil sekali, struk bertanggal kemarin 23:59 WIB, nomor memakai tanggal itu, tanpa poin", async (_l, action) => {
  expect(await run(action, mundur())).toContain("/struk/sale");
  expect(state.authorized).toEqual([{ p_branch: "branch", p_checkout_key: "draft-mundur", p_date: KEMARIN, p_reason: "Barang lupa diinput kemarin" }]);
  expect(state.headers).toHaveLength(1);
  expect(state.headers[0]).toMatchObject({ created_at: `${KEMARIN}T23:59:00+07:00`, poin_earned: 0, total: 100000 });
  expect(state.numbering).toEqual([KEMARIN]);
  expect(state.periods).toEqual(expect.arrayContaining([HARI_INI, KEMARIN]));
});

it.each(BOTH)("%s: tanggal mundur mengubah sidik jari draft (kunci sama + tanggal beda bukan transaksi yang sama)", async (_l, action) => {
  await run(action, mundur());
  const a = state.headers[0].checkout_fingerprint; state.headers = []; state.prior = null;
  await run(action, tunai());
  const b = state.headers[0].checkout_fingerprint; state.headers = []; state.prior = null;
  await run(action, mundur({ tanggal_pembukuan: geserHari(HARI_INI, -2) }));
  const c = state.headers[0].checkout_fingerprint;
  expect(new Set([a, b, c]).size).toBe(3);
});

it.each(BOTH)("%s: tanpa alasan ditolak sebelum apa pun disimpan", async (_l, action) => {
  const data = mundur(); data.set("alasan_tanggal", "  ");
  expect(await run(action, data)).toContain(encodeURIComponent("Alasan mencatat di tanggal lain wajib diisi"));
  expect(state.authorized).toHaveLength(0); expect(state.headers).toHaveLength(0); expect(state.finalized).toEqual([]);
});

it.each(BOTH)("%s: tanggal masa depan, tidak valid, dan lebih dari 31 hari ditolak; tepat 31 hari lolos ke izin-pakai", async (_l, action) => {
  expect(await run(action, mundur({ tanggal_pembukuan: geserHari(HARI_INI, 1) }))).toContain(encodeURIComponent("belum tiba"));
  expect(await run(action, mundur({ tanggal_pembukuan: "2026-02-30" }))).toContain(encodeURIComponent("tidak valid"));
  expect(await run(action, mundur({ tanggal_pembukuan: geserHari(HARI_INI, -32) }))).toContain(encodeURIComponent("31 hari"));
  expect(state.headers).toHaveLength(0); expect(state.authorized).toHaveLength(0);
  expect(await run(action, mundur({ tanggal_pembukuan: geserHari(HARI_INI, -31) }))).toContain("/struk/sale");
  expect(state.authorized[0]).toMatchObject({ p_date: geserHari(HARI_INI, -31) });
});

it.each(BOTH)("%s: voucher / kode kampanye ditolak pada tanggal mundur", async (_l, action) => {
  expect(await run(action, mundur({ voucherCode: "HEMAT10" }))).toContain(encodeURIComponent("Voucher dan kode kampanye tidak berlaku"));
  expect(state.headers).toHaveLength(0); expect(state.authorized).toHaveLength(0);
});

it("kasir: poin yang dipakai ditolak pada tanggal mundur", async () => {
  expect(await run(checkoutKasir, mundur({ poinDigunakan: "50" }))).toContain(encodeURIComponent("Poin tidak dipakai"));
  expect(state.headers).toHaveLength(0); expect(state.authorized).toHaveLength(0);
});

it("kasir: transaksi pengganti tidak boleh bertanggal mundur", async () => {
  const data = mundur({ replacementSaleId: "11111111-1111-4111-8111-111111111111" });
  expect(await run(checkoutKasir, data)).toContain(encodeURIComponent("Transaksi pengganti"));
  expect(state.headers).toHaveLength(0);
});

it.each(BOTH)("%s: promo yang kena pada keranjang menolak tanggal mundur; tanpa promo tetap normal", async (_l, action) => {
  state.promos = [{ id: "promo-1", name: "Promo uji", itemIds: ["item"], minQty: 1, maxQty: null, kelipatan: false, autoApply: true, discountType: "percent", discountValue: 10, discountMode: "per_unit", minSubtotal: null }];
  expect(await run(action, mundur())).toContain(encodeURIComponent("Promo tidak dihitung pada transaksi tanggal mundur"));
  expect(state.headers).toHaveLength(0); expect(state.authorized).toHaveLength(0); expect(state.finalized).toEqual([]);
  // jalur biasa (hari ini) dengan promo yang sama tetap berjalan: aturan mundur tidak menyentuhnya
  const biasa = tunai({ bayar: "90000" });
  expect(await run(action, biasa)).toContain("/struk/sale");
  expect(state.headers[0]).not.toHaveProperty("created_at");
});

it.each(BOTH)("%s: database menolak izin (peran tanpa hak) -> pesan database apa adanya, tidak ada struk/stok", async (_l, action) => {
  state.authorizeError = "Anda tidak punya izin mencatat penjualan di tanggal sebelum hari ini. Minta Owner mencentang \"Tanggal mundur\" untuk peran Anda.";
  expect(await run(action, mundur())).toContain(encodeURIComponent("Anda tidak punya izin mencatat penjualan di tanggal sebelum hari ini"));
  expect(state.authorized).toHaveLength(1); expect(state.headers).toHaveLength(0); expect(state.finalized).toEqual([]);
});

it.each(BOTH)("%s: galat teknis database diganti kalimat aman (tidak membocorkan SQL)", async (_l, action) => {
  state.authorizeError = "permission denied for table pos_sale_backdates";
  const out = await run(action, mundur());
  expect(out).toContain(encodeURIComponent("Tanggal mundur belum dapat diizinkan"));
  expect(out).not.toContain("permission");
  expect(state.headers).toHaveLength(0);
});

it.each(BOTH)("%s: periode tanggal mundur ditutup -> ditolak sebelum izin-pakai dan sebelum menyimpan", async (_l, action) => {
  state.periodClosed = KEMARIN;
  expect(await run(action, mundur())).toContain(encodeURIComponent("Periode akuntansi ditutup"));
  expect(state.authorized).toHaveLength(0); expect(state.headers).toHaveLength(0);
});

it.each(BOTH)("%s: gagal memposting stok/final -> struk mundur dibersihkan seperti struk biasa", async (_l, action) => {
  state.finalizationError = "Pembukuan gagal";
  const out = await run(action, mundur());
  expect(out).not.toContain("/struk/sale");
  expect(state.removed).toBe(true);
});

it.each(BOTH)("%s: diskon manual tanpa izin tetap ditolak pada tanggal mundur (aturan #512 tidak longgar)", async (_l, action) => {
  const data = mundur(action === checkoutKasir ? { diskon: "5000" } : { discount: "5000" });
  expect(await run(action, data)).toContain("Diskon%20manual%20hanya%20bisa%20diberikan%20Owner%2FAdmin");
  expect(state.headers).toHaveLength(0);
});
