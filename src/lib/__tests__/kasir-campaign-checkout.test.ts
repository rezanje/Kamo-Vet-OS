import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ headers: [] as Record<string, unknown>[], items: [] as Record<string, unknown>[], finalized: [] as string[], removed: false, finalizationError: "", confirmation: true, stock: false, stockCost: 34567, pointsWrites: 0, prior: null as null | Record<string, unknown>, lostResponse: false, tierUnavailable: false, saleError: "" }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/penjual", () => ({ penjualValid: async () => true }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "POS-SPLIT-TEST" }) }));
vi.mock("@/lib/posting", () => ({ postJournal: async () => {} }));
vi.mock("@/lib/quest-hook", () => ({ processQuestProgress: async () => {} }));
vi.mock("@/lib/inventory", () => ({ stockOut: async () => ({ cost: 34567 }) }));
vi.mock("@/lib/harga-cabang", () => ({ loadHargaCabang: async () => new Map(), hargaCabang: (_map: unknown, _id: string, _unit: string, price: number) => price, applyHargaCabang: (options: unknown) => options }));
vi.mock("@/lib/promo-hitung", async original => ({ ...await original<typeof import("@/lib/promo-hitung")>(), loadPromoAktif: async () => [] }));
vi.mock("@/lib/satuan", async original => ({ ...await original<typeof import("@/lib/satuan")>(), loadUnitOptions: async () => new Map([["item", [{ unit: "pcs", factor: 1, sell_price: 100000, buy_price: 0 }]]]) }));
const { KAMPANYE, VOUCHER } = vi.hoisted(() => ({ KAMPANYE: {
  PROMO10: { code: "PROMO10", voucher_id: "v1", promo_id: null, is_active: true, max_uses: 2, vouchers: { code: "HEMAT10" } },
  MATI: { code: "MATI", voucher_id: "v1", promo_id: null, is_active: false, max_uses: null, vouchers: { code: "HEMAT10" } },
} as Record<string, unknown>,
VOUCHER: { code: "HEMAT10", tipe: "persen", nilai: 10, is_active: true, valid_from: null, valid_until: null, max_potongan: null, min_belanja: 0, boleh_gabung_promo: true, customer_id: null, category_id: null } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (name: string, values: { p_sale_id: string }) => {
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
    let data: unknown = table === "items" ? [{ id: "item", nama: "Pakan", name: "Pakan", unit: "pcs", item_type: state.stock ? "Persediaan" : "Jasa", sell_price: 100000, buy_price: 30000, min_sell_qty: 1, is_active: true }]
      : table === "stock_layers" && state.stock ? [{ id: "layer", item_id: "item", qty_left: 1, unit_cost: state.stockCost, exp_date: null, tanggal: "2026-10-15", created_at: "2026-10-15T00:00:00Z" }] : [];
    const single = () => table === "campaign_codes" ? { data: KAMPANYE[codeQuery as string] ?? null, error: null }
      : table === "vouchers" ? { data: codeQuery === "HEMAT10" ? VOUCHER : codeQuery === "BEBAS10" ? { ...VOUCHER, code: "BEBAS10" } : null, error: null }
      : table === "sales" && !lookup && state.saleError ? { data: null, error: { message: state.saleError } }
      : ({ data: table === "sales" && lookup ? state.prior : table === "cashier_shifts" ? { id: "shift", branch_id: "branch" }
      : table === "customers" ? { points: 0, total_spending: 0, category_id: null, customer_categories: null }
        : table === "warehouses" ? (state.stock ? { id: "warehouse" } : null) : { id: table === "sales" ? "sale" : "line" }, error: null });
    let codeQuery: unknown = null;
    let linkedVoucher: unknown = null;
    let activeOnly = false;
    const query = {
      select: (fields: string) => { lookup = fields.includes("checkout_fingerprint"); return query; }, eq: (key: string, value: unknown) => { if (key === "code") codeQuery = value; if (key === "vouchers.code") linkedVoucher = value; if (table === "campaign_codes" && key === "is_active") activeOnly = value === true; if (table === "sale_items" && key === "id" && lineUpdate) state.items.filter(item => item.id === value).forEach(item => Object.assign(item, lineUpdate)); return query; }, in: () => query, gt: () => query, lte: () => query, not: () => query, order: () => query, range: () => query, limit: () => query,
      insert: (value: Record<string, unknown>) => { if (table === "sales" && !state.saleError) { state.headers.push(value); data = value; state.prior = { id: "sale", no_struk: "POS-SPLIT-TEST", checkout_fingerprint: value.checkout_fingerprint, payments_finalized_at: null }; } if (table === "sale_items") state.items.push({ id: "line", ...value }); if (table === "point_ledger") state.pointsWrites++; return query; },
      update: (value: Record<string, unknown>) => { lineUpdate = value; return query; }, delete: () => { if (table === "sales") { state.removed = true; state.prior = null; } return query; },
      single: async () => single(), maybeSingle: async () => single(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "campaign_codes" && linkedVoucher !== null
        ? Object.values(KAMPANYE).filter(k => { const row = k as { is_active: boolean; vouchers: { code: string } }; return (!activeOnly || row.is_active) && row.vouchers.code === linkedVoucher; })
        : data, count: Array.isArray(data) ? data.length : 0, error: null }).then(resolve),
    };
    return query;
  },
}) }));
import { checkoutKasir } from "@/app/kasir/checkout";

// C05 end to end on the cashier server action: the typed campaign code becomes the bound
// voucher's discount, and both codes are stored on the receipt header the database guards.
beforeEach(() => { state.headers = []; state.items = []; state.finalized = []; state.removed = false; state.finalizationError = ""; state.confirmation = true; state.stock = false; state.stockCost = 34567; state.pointsWrites = 0; state.prior = null; state.lostResponse = false; state.tierUnavailable = false; state.saleError = ""; });
function form(code: string) {
  const data = new FormData();
  Object.entries({ customerId: "customer", metode: "Tunai", bayar: "100000", operationalShiftId: "shift", checkout_key: "checkout-c05", voucherCode: code,
    cart: JSON.stringify([{ item_id: "item", nama: "Pakan", qty: 1, harga: 100000, target_species: "Universal", satuan: "pcs" }]) }).forEach(([key, value]) => data.set(key, value));
  return data;
}

it("redeems campaign code promo10 as voucher HEMAT10 and records both on the receipt", async () => {
  const outcome = await checkoutKasir(form(" promo 10")).then(() => "unexpected success", error => error.message);
  expect(outcome).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ total: 90000, voucher_code: "HEMAT10", campaign_code: "PROMO10" });
});

it("plain voucher codes keep working without a campaign code", async () => {
  await checkoutKasir(form("bebas10")).catch(() => undefined);
  expect(state.headers[0]).toMatchObject({ total: 90000, voucher_code: "BEBAS10" });
  expect(state.headers[0]).not.toHaveProperty("campaign_code");   // old schema keeps working until the DB step
});

it("refuses a raw voucher that belongs to an active campaign before creating a receipt", async () => {
  const outcome = await checkoutKasir(form("hemat10")).then(() => "unexpected success", error => error.message);
  expect(decodeURIComponent(outcome)).toContain("error=Voucher ini hanya bisa dipakai lewat kode kampanye");
  expect(state.headers).toHaveLength(0);
});

it("refuses an inactive campaign code before creating a receipt", async () => {
  const outcome = await checkoutKasir(form("MATI")).then(() => "unexpected success", error => error.message);
  expect(decodeURIComponent(outcome)).toContain("Kode MATI sedang dinonaktifkan");
  expect(state.headers).toHaveLength(0);
});

it("shows the cap message when payment finalization re-checks the cap and refuses", async () => {
  state.finalizationError = "KODE_KAMPANYE: Kode PROMO10 sudah mencapai batas pemakaian (2 kali)";
  const outcome = await checkoutKasir(form("PROMO10")).then(() => "unexpected success", error => error.message);
  expect(decodeURIComponent(outcome)).toContain("error=Kode PROMO10 sudah mencapai batas pemakaian (2 kali)");
  expect(state.removed).toBe(true);                      // unfinished receipt is cleaned up
});

it("shows the database cap message when the code is used up", async () => {
  state.saleError = "KODE_KAMPANYE: Kode PROMO10 sudah mencapai batas pemakaian (2 kali)";
  const outcome = await checkoutKasir(form("PROMO10")).then(() => "unexpected success", error => error.message);
  expect(decodeURIComponent(outcome)).toContain("error=Kode PROMO10 sudah mencapai batas pemakaian (2 kali)");
  expect(state.finalized).toEqual([]);
});
