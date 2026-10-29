import { beforeEach, expect, it, vi } from "vitest";

// C05 follow-up: campaign code in back-office POS (/pos/transaksi). Same fictional
// harness as kasir-campaign-checkout.test.ts, driving the back-office server action.
const state = vi.hoisted(() => ({ headers: [] as Record<string, unknown>[], items: [] as Record<string, unknown>[], finalized: [] as string[], removed: false, finalizationError: "", saleError: "", prior: null as null | Record<string, unknown>, lostResponse: false, promoIds: [] as string[][] }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "POS-BO-C05" }) }));
vi.mock("@/lib/inventory", () => ({ stockOut: async () => ({ cost: 0 }) }));
vi.mock("@/lib/customer-tier", () => ({ recomputeCustomerTier: async () => true }));
vi.mock("@/lib/harga-cabang", () => ({ loadHargaCabang: async () => new Map(), hargaCabang: (_map: unknown, _id: string, _unit: string, price: number) => price }));
vi.mock("@/lib/promo-hitung", async original => ({ ...await original<typeof import("@/lib/promo-hitung")>(),
  // The campaign promo is not "potong otomatis": it is only loaded because its code was typed.
  loadPromoAktif: async (_s: unknown, _b: string, ids: string[] = []) => { state.promoIds.push(ids); return ids.includes("p-kode") ? [{
    id: "p-kode", name: "Promo kode", itemIds: ["item"], minQty: null, maxQty: null, kelipatan: false, autoApply: false, discountType: "percent", discountValue: 20 }] : []; } }));
vi.mock("@/lib/satuan", async original => ({ ...await original<typeof import("@/lib/satuan")>(), loadUnitOptions: async () => new Map([["item", [{ unit: "pcs", factor: 1, sell_price: 100000, buy_price: 0 }]]]) }));
const { KAMPANYE, VOUCHER } = vi.hoisted(() => ({ KAMPANYE: {
  PROMO10: { code: "PROMO10", voucher_id: "v1", promo_id: null, is_active: true, max_uses: 2, vouchers: { code: "HEMAT10" } },
  DISKON20: { code: "DISKON20", voucher_id: null, promo_id: "p-kode", is_active: true, max_uses: null, vouchers: null },
  MATI: { code: "MATI", voucher_id: "v1", promo_id: null, is_active: false, max_uses: null, vouchers: { code: "HEMAT10" } },
} as Record<string, unknown>,
VOUCHER: { code: "HEMAT10", tipe: "persen", nilai: 10, is_active: true, valid_from: null, valid_until: null, max_potongan: null, min_belanja: 0, boleh_gabung_promo: true, customer_id: null, category_id: null } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (name: string, values: { p_sale_id: string }) => {
    if (name === "refresh_customer_spending") return { data: true, error: null };
    if (name !== "finalize_pos_sale") throw Error(`Unexpected RPC ${name}`);
    if (state.lostResponse) {
      state.lostResponse = false;
      state.prior = { id: "sale", no_struk: "POS-BO-C05", checkout_fingerprint: state.headers[0]?.checkout_fingerprint, payments_finalized_at: "2026-10-29T08:00:00Z" };
      return { data: null, error: { message: "Connection lost after commit" } };
    }
    if (state.finalizationError) return { data: null, error: { message: state.finalizationError } };
    state.finalized.push(values.p_sale_id);
    if (state.prior) state.prior.payments_finalized_at = "2026-10-29T08:00:00Z";
    return { data: { sale_id: values.p_sale_id, journal_id: "journal", finalized: true }, error: null };
  },
  from(table: string) {
    let lookup = false;
    let codeQuery: unknown = null;
    let data: unknown = table === "items" ? [{ id: "item", item_type: "Persediaan", tindakan_kategori: null }] : [];
    const single = () => table === "campaign_codes" ? { data: KAMPANYE[codeQuery as string] ?? null, error: null }
      : table === "vouchers" ? { data: codeQuery === "HEMAT10" ? VOUCHER : null, error: null }
      : table === "sales" && !lookup && state.saleError ? { data: null, error: { message: state.saleError } }
      : ({ data: table === "sales" && lookup ? state.prior
        : table === "customers" ? { category_id: null, customer_categories: null }
        : table === "cashier_shifts" ? null
        : table === "warehouses" ? { id: "warehouse" } : { id: table === "sales" ? "sale" : "line" }, error: null });
    const query = {
      select: (fields: string) => { lookup = String(fields).includes("checkout_fingerprint"); return query; },
      eq: (key: string, value: unknown) => { if (key === "code") codeQuery = value; return query; },
      in: () => query, gt: () => query, lte: () => query, not: () => query, order: () => query, range: () => query, limit: () => query,
      insert: (value: Record<string, unknown>) => { if (table === "sales" && !state.saleError) { state.headers.push(value); data = value; state.prior = { id: "sale", no_struk: "POS-BO-C05", checkout_fingerprint: value.checkout_fingerprint, payments_finalized_at: null }; } if (table === "sale_items") state.items.push(value); return query; },
      update: () => query, delete: () => { if (table === "sales") { state.removed = true; state.prior = null; } return query; },
      single: async () => single(), maybeSingle: async () => single(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, count: Array.isArray(data) ? data.length : 0, error: null }).then(resolve),
    };
    return query;
  },
}) }));
vi.mock("@/lib/service-performers-server", () => ({
  loggedInCashier: async () => ({ name: "Kasir BO", employeeId: null }),
  validateServicePerformerRows: async (_s: unknown, _b: string, rows: unknown[]) => rows.map(() => null),
}));
import { checkoutSale } from "@/app/(app)/pos/transaksi/actions";

beforeEach(() => { state.headers = []; state.items = []; state.finalized = []; state.removed = false; state.finalizationError = ""; state.saleError = ""; state.prior = null; state.lostResponse = false; state.promoIds = []; });
function form(code: string) {
  const data = new FormData();
  Object.entries({ branchId: "branch", customerId: "customer", metode: "Tunai", bayar: "100000", checkout_key: "bo-c05", voucherCode: code,
    cart: JSON.stringify([{ item_id: "item", nama: "Pakan", qty: 1, harga: 100000, target_species: "Universal", satuan: "pcs" }]) }).forEach(([key, value]) => data.set(key, value));
  return data;
}
const run = (code: string) => checkoutSale(form(code)).then(() => "unexpected success", (error: Error) => decodeURIComponent(error.message));

it("redeems voucher-bound campaign code PROMO10 as voucher HEMAT10 and records both on the receipt", async () => {
  expect(await run(" promo 10")).toContain("/pos/struk/sale");
  expect(state.headers[0]).toMatchObject({ subtotal: 100000, discount: 10000, total: 90000, voucher_code: "HEMAT10", campaign_code: "PROMO10" });
  expect(state.finalized).toEqual(["sale"]);
});

it("promo-bound code loads and applies its own promo only when typed", async () => {
  expect(await run("diskon20")).toContain("/pos/struk/sale");
  expect(state.promoIds).toEqual([["p-kode"]]);
  expect(state.headers[0]).toMatchObject({ total: 80000, campaign_code: "DISKON20", voucher_code: null });
  expect(state.items[0]).toMatchObject({ promo_id: "p-kode", promo_discount: 20000 });
});

it("without a code nothing changes: no campaign columns are written (old schema keeps working)", async () => {
  expect(await run("")).toContain("/pos/struk/sale");
  expect(state.headers[0]).toMatchObject({ total: 100000 });
  expect(state.headers[0]).not.toHaveProperty("campaign_code");
  expect(state.headers[0]).not.toHaveProperty("voucher_code");
  expect(state.promoIds).toEqual([[]]);
});

it("refuses a plain voucher code: back-office takes campaign codes only", async () => {
  expect(await run("HEMAT10")).toContain("error=Kode HEMAT10 bukan kode kampanye");
  expect(state.headers).toHaveLength(0);
});

it("refuses an inactive campaign code before creating a receipt", async () => {
  expect(await run("MATI")).toContain("error=Kode MATI sedang dinonaktifkan");
  expect(state.headers).toHaveLength(0);
});

it("shows the database cap message when the receipt is written after the code is used up", async () => {
  state.saleError = "KODE_KAMPANYE: Kode PROMO10 sudah mencapai batas pemakaian (2 kali)";
  expect(await run("PROMO10")).toContain("error=Kode PROMO10 sudah mencapai batas pemakaian (2 kali)");
  expect(state.finalized).toEqual([]);
});

it("shows the cap message when payment finalization re-checks the cap, and removes the unfinished receipt", async () => {
  state.finalizationError = "KODE_KAMPANYE: Kode PROMO10 sudah mencapai batas pemakaian (2 kali)";
  expect(await run("PROMO10")).toContain("error=Kode PROMO10 sudah mencapai batas pemakaian (2 kali)");
  expect(state.removed).toBe(true);
});

it("a lost response is retried idempotently: the same draft opens the stored receipt, no second receipt", async () => {
  state.lostResponse = true;
  await run("PROMO10");
  expect(await run("PROMO10")).toContain("/pos/struk/sale");
  expect(state.headers).toHaveLength(1);
});

it("the typed code is part of the draft identity: a changed code cannot reuse a used draft", async () => {
  await run("PROMO10");
  expect(await run("DISKON20")).toContain("Draft ini sudah digunakan");
  expect(state.headers).toHaveLength(1);
});
