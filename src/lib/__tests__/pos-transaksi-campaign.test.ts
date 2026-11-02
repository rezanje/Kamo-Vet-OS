import { beforeEach, expect, it, vi } from "vitest";

// C05 + Q01 on the POS back-office action (/pos/transaksi): campaign codes resolve to their
// voucher/promo like /kasir (raw voucher codes are NOT accepted here), the database cap message
// is shown as is, and every paid sale triggers the staff quest hook.
const state = vi.hoisted(() => ({ headers: [] as Record<string, unknown>[], finalized: [] as string[], removed: false, finalizationError: "", saleError: "", quest: [] as string[] }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "POS-BO-C05" }) }));
vi.mock("@/lib/quest-hook", () => ({ processQuestProgress: async (_s: unknown, opts: { saleId: string }) => { state.quest.push(opts.saleId); } }));
vi.mock("@/lib/inventory", () => ({ stockOut: async () => { throw Error("per-line stockOut is not allowed in backoffice checkout"); } }));
vi.mock("@/lib/customer-tier", () => ({ recomputeCustomerTier: async () => true }));
vi.mock("@/lib/harga-cabang", () => ({ loadHargaCabang: async () => new Map(), hargaCabang: (_map: unknown, _id: string, _unit: string, price: number) => price }));
vi.mock("@/lib/promo-hitung", async original => ({ ...await original<typeof import("@/lib/promo-hitung")>(),
  loadPromoAktif: async (_s: unknown, _b: string, kodeIds: string[] = []) => kodeIds.includes("promo-kode")
    ? [{ id: "promo-kode", name: "Promo kode", itemIds: ["item"], minQty: null, maxQty: null, kelipatan: false, autoApply: false, discountType: "percent" as const, discountValue: 20 }]
    : [] }));
vi.mock("@/lib/satuan", async original => ({ ...await original<typeof import("@/lib/satuan")>(), loadUnitOptions: async () => new Map([["item", [{ unit: "pcs", factor: 1, sell_price: 100000, buy_price: 0 }]]]) }));
const { KAMPANYE, VOUCHER } = vi.hoisted(() => ({ KAMPANYE: {
  PROMO10: { code: "PROMO10", voucher_id: "v1", promo_id: null, is_active: true, max_uses: 2, vouchers: { code: "HEMAT10" } },
  MATI: { code: "MATI", voucher_id: "v1", promo_id: null, is_active: false, max_uses: null, vouchers: { code: "HEMAT10" } },
} as Record<string, unknown>,
VOUCHER: { code: "HEMAT10", tipe: "persen", nilai: 10, is_active: true, valid_from: null, valid_until: null, max_potongan: null, min_belanja: 0, boleh_gabung_promo: true, customer_id: null, category_id: null } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  // The branch has an active warehouse, so stock, cost and the original finalizer
  // (with its campaign quota check) run inside one atomic posting call.
  rpc: async (name: string, values: { p_sale_id: string; p_warehouse_id: string }) => {
    if (name !== "pos_backoffice_post_atomic" || values.p_warehouse_id !== "warehouse") throw Error(`Unexpected RPC ${name}`);
    if (state.finalizationError) return { data: null, error: { message: state.finalizationError } };
    state.finalized.push(values.p_sale_id);
    return { data: { sale_id: values.p_sale_id, finalized: true, checked: true, stock_events: 0 }, error: null };
  },
  from(table: string) {
    let codeQuery: unknown = null;
    let lookup = false;                                  // resumePosCheckout: no earlier sale
    let data: unknown = table === "items" ? [{ id: "item", item_type: "Jasa", tindakan_kategori: null }] : [];
    const single = () => table === "campaign_codes" ? { data: KAMPANYE[codeQuery as string] ?? null, error: null }
      : table === "vouchers" ? { data: codeQuery === "HEMAT10" ? VOUCHER : null, error: null }
      : table === "sales" && lookup ? { data: null, error: null }
      : table === "sales" && state.saleError ? { data: null, error: { message: state.saleError } }
      : { data: table === "sales" ? { id: "sale" } : table === "sale_items" ? { id: "line" } : table === "customers" ? { category_id: null, customer_categories: null } : table === "warehouses" ? { id: "warehouse" } : null, error: null };
    const query = {
      select: (fields?: string) => { lookup = String(fields ?? "").includes("checkout_fingerprint"); return query; }, eq: (key: string, value: unknown) => { if (key === "code") codeQuery = value; return query; },
      in: () => query, order: () => query, range: () => query, limit: () => query, is: () => query,
      insert: (value: Record<string, unknown>) => { if (table === "sales" && !state.saleError) { state.headers.push(value); data = value; } return query; },
      update: () => query, delete: () => { if (table === "sales") state.removed = true; return query; },
      single: async () => single(), maybeSingle: async () => single(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, count: Array.isArray(data) ? data.length : 0, error: null }).then(resolve),
    };
    return query;
  },
}) }));
import { checkoutSale } from "@/app/(app)/pos/transaksi/actions";

beforeEach(() => { state.headers = []; state.finalized = []; state.removed = false; state.finalizationError = ""; state.saleError = ""; state.quest = []; });
function form(code: string) {
  const data = new FormData();
  Object.entries({ branchId: "branch", customerId: "customer", metode: "Tunai", bayar: "100000", checkout_key: "bo-c05", voucherCode: code,
    cart: JSON.stringify([{ item_id: "item", nama: "Grooming", qty: 1, harga: 100000, target_species: "Universal", satuan: "pcs" }]) }).forEach(([key, value]) => data.set(key, value));
  return data;
}
const run = (code: string) => checkoutSale(form(code)).then(() => "unexpected success", (error: Error) => decodeURIComponent(error.message));

it("redeems a voucher-bound campaign code and records both codes on the receipt", async () => {
  expect(await run(" promo 10")).toContain("/pos/struk/sale");
  expect(state.headers[0]).toMatchObject({ total: 90000, voucher_code: "HEMAT10", campaign_code: "PROMO10" });
  expect(state.finalized).toEqual(["sale"]);
});

it("applies a promo-bound campaign code's promo even though it is not automatic", async () => {
  KAMPANYE.DISKON20 = { code: "DISKON20", voucher_id: null, promo_id: "promo-kode", is_active: true, max_uses: null, vouchers: null };
  expect(await run("diskon20")).toContain("/pos/struk/sale");
  expect(state.headers[0]).toMatchObject({ total: 80000, voucher_code: null, campaign_code: "DISKON20" });
});

it("keeps a sale without a code unchanged (no code columns written)", async () => {
  expect(await run("")).toContain("/pos/struk/sale");
  expect(state.headers[0]).toMatchObject({ total: 100000 });
  expect(state.headers[0]).not.toHaveProperty("campaign_code");
  expect(state.headers[0]).not.toHaveProperty("voucher_code");
});

it("does not accept a raw voucher code on the back-office screen", async () => {
  expect(await run("HEMAT10")).toContain("error=Kode kampanye HEMAT10 tidak ditemukan");
  expect(state.headers).toHaveLength(0);
});

it("refuses an inactive campaign code before creating a receipt", async () => {
  expect(await run("MATI")).toContain("Kode MATI sedang dinonaktifkan");
  expect(state.headers).toHaveLength(0);
});

it("shows the database cap message when payment finalization refuses, and removes the receipt", async () => {
  state.finalizationError = "KODE_KAMPANYE: Kode PROMO10 sudah mencapai batas pemakaian (2 kali)";
  expect(await run("PROMO10")).toContain("error=Kode PROMO10 sudah mencapai batas pemakaian (2 kali)");
  expect(state.removed).toBe(true);
  expect(state.quest).toEqual([]);
});

it("runs the staff quest hook (Q01) after every paid back-office sale", async () => {
  await run("");
  expect(state.quest).toEqual(["sale"]);
});
