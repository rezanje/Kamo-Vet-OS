import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ headers: [] as Record<string, unknown>[], items: [] as Record<string, unknown>[], finalized: [] as string[], removed: false, finalizationError: "", confirmation: true, stock: false, stockCost: 34567, pointsWrites: 0, prior: null as null | Record<string, unknown>, lostResponse: false, tierUnavailable: false, allowed: false, defaultDiscount: 0 }));
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

beforeEach(() => { state.headers = []; state.items = []; state.finalized = []; state.removed = false; state.finalizationError = ""; state.confirmation = true; state.stock = false; state.stockCost = 34567; state.pointsWrites = 0; state.prior = null; state.lostResponse = false; state.tierUnavailable = false; state.allowed = false; state.defaultDiscount = 0; });
function form(parts = [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }]) {
  const data = new FormData();
  Object.entries({ branchId: "branch", customerId: "customer", salespersonId: "seller", metode: "Split", bayar: "20000", split_payments: JSON.stringify(parts), operationalShiftId: "shift", checkout_key: "checkout-draft",
    cart: JSON.stringify([{ item_id: "item", nama: "Pakan", qty: 1, harga: 100000, target_species: "Universal", satuan: "pcs" }]) }).forEach(([key, value]) => data.set(key, value));
  return data;
}

const run = (action: (data: FormData) => Promise<unknown>, data: FormData) => action(data).then(() => "unexpected success", (error: Error) => error.message);
const DITOLAK = "Diskon%20manual%20hanya%20bisa%20diberikan%20Owner%2FAdmin";
const tunai = () => { const data = form(); data.set("metode", "Tunai"); data.set("bayar", "100000"); data.delete("split_payments"); return data; };

it.each([["cashier", checkoutKasir], ["backoffice", checkoutSale]] as const)("%s: tanpa izin, diskon total ditolak dan tidak ada transaksi tersimpan", async (_label, action) => {
  const data = tunai();
  data.set(action === checkoutKasir ? "diskon" : "discount", "5000");
  expect(await run(action, data)).toContain(DITOLAK);
  expect(state.headers).toHaveLength(0);
  expect(state.finalized).toEqual([]);
});

it.each([["cashier", checkoutKasir], ["backoffice", checkoutSale]] as const)("%s: tanpa izin, transaksi tanpa diskon tetap jalan", async (_label, action) => {
  expect(await run(action, tunai())).toContain("/struk/sale");
  expect(state.headers).toHaveLength(1);
});

it.each([["cashier", checkoutKasir], ["backoffice", checkoutSale]] as const)("%s: dengan izin (Owner/Admin), diskon total tersimpan", async (_label, action) => {
  state.allowed = true;
  const data = tunai();
  data.set(action === checkoutKasir ? "diskon" : "discount", "5000");
  data.set("bayar", "95000");
  expect(await run(action, data)).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ total: 95000 });
});

it("kasir: tanpa izin, potongan per barang yang diketik ditolak", async () => {
  const data = tunai();
  data.set("cart", JSON.stringify([{ item_id: "item", nama: "Pakan", qty: 1, harga: 100000, satuan: "pcs", item_discount_type: "nominal", item_discount_value: 10000 }]));
  expect(await run(checkoutKasir, data)).toContain(DITOLAK);
  expect(state.headers).toHaveLength(0);
});

it("kasir: tanpa izin, diskon bawaan barang dari master tetap boleh", async () => {
  state.defaultDiscount = 10;
  const data = tunai();
  data.set("bayar", "90000");
  data.set("cart", JSON.stringify([{ item_id: "item", nama: "Pakan", qty: 1, harga: 100000, satuan: "pcs", item_discount_type: "percent", item_discount_value: 10 }]));
  expect(await run(checkoutKasir, data)).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ total: 90000 });
});

it("kasir: tanpa izin, menaikkan diskon bawaan ditolak", async () => {
  state.defaultDiscount = 10;
  const data = tunai();
  data.set("cart", JSON.stringify([{ item_id: "item", nama: "Pakan", qty: 1, harga: 100000, satuan: "pcs", item_discount_type: "percent", item_discount_value: 50 }]));
  expect(await run(checkoutKasir, data)).toContain(DITOLAK);
  expect(state.headers).toHaveLength(0);
});
