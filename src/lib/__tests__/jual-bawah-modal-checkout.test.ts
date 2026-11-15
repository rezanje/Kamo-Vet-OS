import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ headers: [] as Record<string, unknown>[], items: [] as Record<string, unknown>[], finalized: [] as string[], removed: false, finalizationError: "", confirmation: true, stock: false, stockCost: 34567, pointsWrites: 0, prior: null as null | Record<string, unknown>, lostResponse: false, tierUnavailable: false, allowed: false, defaultDiscount: 0, bawah: false, bawahRpcCalls: 0 }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
// Izin diskon manual dibaca lewat RPC manual_discount_allowed (diatur state.allowed).
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/penjual", () => ({ penjualValid: async () => true }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "POS-SPLIT-TEST" }) }));
vi.mock("@/lib/posting", () => ({ postJournal: async () => {} }));
vi.mock("@/lib/quest-hook", () => ({ processQuestProgress: async () => {} }));
vi.mock("@/lib/inventory", () => ({ stockOut: async () => ({ cost: 34567 }) }));
vi.mock("@/lib/harga-cabang", () => ({ loadHargaCabang: async () => new Map(), hargaCabang: (_map: unknown, _id: string, _unit: string, price: number) => price, applyHargaCabang: (options: unknown) => options }));
vi.mock("@/lib/promo-hitung", async original => ({ ...await original<typeof import("@/lib/promo-hitung")>(), loadPromoAktif: async () => [] }));
vi.mock("@/lib/satuan", async original => ({ ...await original<typeof import("@/lib/satuan")>(), loadUnitOptions: async () => new Map([["item", [{ unit: "pcs", factor: 1, sell_price: 100000, buy_price: 0 }]]]) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (name: string, values: { p_sale_id: string }) => {
    if (name === "manual_discount_allowed") return { data: state.allowed, error: null };
    if (name === "below_cost_sale_allowed") { state.bawahRpcCalls++; return { data: state.bawah, error: null }; }
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

beforeEach(() => { state.headers = []; state.items = []; state.finalized = []; state.removed = false; state.finalizationError = ""; state.confirmation = true; state.stock = true; state.stockCost = 60000; state.pointsWrites = 0; state.prior = null; state.lostResponse = false; state.tierUnavailable = false; state.allowed = true; state.defaultDiscount = 0; state.bawah = false; state.bawahRpcCalls = 0; });

const run = (action: (data: FormData) => Promise<unknown>, data: FormData) => action(data).then(() => "unexpected success", (error: Error) => error.message);
// Harga 100.000 x 1, diskon 50% = neto 50.000 < HPP FIFO 60.000: kasus Andri (obral stok hampir kadaluarsa).
function obral(over: Record<string, unknown> = {}, bayar = "50000") {
  const data = new FormData();
  Object.entries({ branchId: "branch", customerId: "customer", salespersonId: "seller", metode: "Tunai", bayar, operationalShiftId: "shift", checkout_key: "checkout-draft",
    cart: JSON.stringify([{ item_id: "item", nama: "Pakan", qty: 1, harga: 100000, satuan: "pcs", item_discount_type: "percent", item_discount_value: 50, ...over }]) }).forEach(([key, value]) => data.set(key, value));
  return data;
}
// POS belakang: tidak ada potongan per barang, hanya diskon total (Owner): neto 50.000 < HPP 60.000.
function obralPos(over: Record<string, unknown> = {}) {
  const data = obral(over, "50000");
  data.set("discount", "50000");
  data.set("cart", JSON.stringify([{ item_id: "item", nama: "Pakan", qty: 1, harga: 100000, satuan: "pcs", row_key: "r1", target_species: "Universal", ...over }]));
  return data;
}
const JALAN = "/struk/sale";
const lines = () => state.items.map(i => i.below_hpp_owner_reason);

it("kasir: Owner/berizin + alasan: lolos, alasan tersimpan pada baris, izin dibaca dari database", async () => {
  state.bawah = true;
  expect(await run(checkoutKasir, obral({ bawah_modal_alasan: "Mau kadaluarsa" }))).toContain(JALAN);
  expect(lines()).toEqual(["Mau kadaluarsa"]);
  expect(state.finalized.length).toBe(1);
  expect(state.bawahRpcCalls).toBeGreaterThan(0);
});
it("kasir: tanpa alasan, ditolak lantai HPP (pesan lama) dan tidak ada struk", async () => {
  state.bawah = true;
  expect(await run(checkoutKasir, obral())).toContain("di%20bawah%20batas%20aman%20HPP%20FIFO");
  expect(lines()).toEqual([]);
});
it("kasir: peran tanpa izin yang mengirim alasan ditolak jelas, tidak ada transaksi", async () => {
  state.bawah = false;
  const pesan = await run(checkoutKasir, obral({ bawah_modal_alasan: "Mau kadaluarsa" }));
  expect(pesan).toContain("Jual%20di%20bawah%20modal%20hanya%20untuk%20Owner");
  expect(state.headers).toHaveLength(0);
});
it("kasir: alasan terlalu pendek atau barang jasa ditolak, tidak ada transaksi", async () => {
  state.bawah = true;
  expect(await run(checkoutKasir, obral({ bawah_modal_alasan: "ab" }))).toContain("Alasan%20jual%20di%20bawah%20modal%20wajib");
  expect(state.headers).toHaveLength(0);
  state.stock = false; // item_type Jasa dari master
  expect(await run(checkoutKasir, obral({ bawah_modal_alasan: "Mau kadaluarsa" }))).toContain("Alasan%20jual%20di%20bawah%20modal%20wajib");
  expect(state.headers).toHaveLength(0);
});
it("kasir: harga neto nol tetap ditolak walau Owner + alasan", async () => {
  state.bawah = true;
  expect(await run(checkoutKasir, obral({ item_discount_value: 100, bawah_modal_alasan: "Mau kadaluarsa" }, "0"))).not.toContain(JALAN);
  expect(lines()).toEqual([]);
});
it("kasir: alasan pada barang yang tidak di bawah modal tidak disimpan", async () => {
  state.bawah = true; state.stockCost = 10000;
  expect(await run(checkoutKasir, obral({ bawah_modal_alasan: "Cuci gudang" }))).toContain(JALAN);
  expect(lines()).toEqual([undefined]);
});
it("kasir: tanpa alasan dikirim, RPC izin tidak dipanggil dan perilaku lama tidak berubah", async () => {
  state.stockCost = 10000;
  expect(await run(checkoutKasir, obral())).toContain(JALAN);
  expect(state.bawahRpcCalls).toBe(0);
});
it("pos belakang: Owner + alasan tidak perlu konfirmasi peringatan, alasan tersimpan", async () => {
  state.bawah = true;
  const data = obralPos({ bawah_modal_alasan: "Rusak kemasan" });
  expect(await run(checkoutSale, data)).toContain(JALAN);
  expect(lines()).toEqual(["Rusak kemasan"]);
});
it("pos belakang: peran tanpa izin yang mengirim alasan ditolak jelas", async () => {
  state.bawah = false;
  const pesan = await run(checkoutSale, obralPos({ bawah_modal_alasan: "Rusak kemasan" }));
  expect(pesan).toContain("Jual%20di%20bawah%20modal%20hanya%20untuk%20Owner");
  expect(state.headers).toHaveLength(0);
});
it("pos belakang: tanpa alasan, perilaku lama (peringatan perlu konfirmasi) tidak berubah", async () => {
  state.bawah = true;
  const pesan = await run(checkoutSale, obralPos());
  expect(pesan).toContain("hpp");
  expect(state.headers).toHaveLength(0);
});
