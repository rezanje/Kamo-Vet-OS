import { beforeEach, expect, it, vi } from "vitest";

// Promo hanya boleh tercatat pada baris yang uangnya benar-benar keluar. Diskon
// manual kasir menang atas promo (lib/pos-calc); kalau promo_id tetap tersimpan di
// baris itu, laporan promo menghitung pemakaian program yang tidak membayar apa pun.
const state = vi.hoisted(() => ({ headers: [] as Record<string, unknown>[], items: [] as Record<string, unknown>[] }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "POS-PROMO-TEST" }) }));
vi.mock("@/lib/quest-hook", () => ({ processQuestProgress: async () => {} }));
vi.mock("@/lib/harga-cabang", () => ({ loadHargaCabang: async () => new Map(), hargaCabang: (_m: unknown, _i: string, _u: string, price: number) => price, applyHargaCabang: (options: unknown) => options }));
vi.mock("@/lib/satuan", async original => ({ ...await original<typeof import("@/lib/satuan")>(),
  loadUnitOptions: async () => new Map([["promo-sku", [{ unit: "pcs", factor: 1, sell_price: 20000, buy_price: 0 }]]]) }));
vi.mock("@/lib/promo-hitung", async original => ({ ...await original<typeof import("@/lib/promo-hitung")>(),
  loadPromoAktif: async () => [{ id: "promo-lebaran", name: "PROMO LEBARAN HEMAT", itemIds: ["promo-sku"],
    minQty: 1, maxQty: null, kelipatan: false, autoApply: true, discountType: "percent" as const, discountValue: 10,
    discountMode: "per_unit" as const, minSubtotal: null }] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (_name: string, values: { p_sale_id: string }) => ({ data: { sale_id: values.p_sale_id, finalized: true, checked: true }, error: null }),
  from(table: string) {
    const data: unknown = table === "items"
      ? [{ id: "promo-sku", nama: "Bolt Ikan 800gr", name: "Bolt Ikan 800gr", unit: "pcs", item_type: "Jasa",
          sell_price: 20000, buy_price: 0, min_sell_qty: 0, is_active: true }]
      : [];
    // Diskon manual (migrasi 20261031120000): berkas ini menguji atribusi promo
    // saat kasir mengetik potongan sendiri, jadi aktornya berperan pemilik.
    const single = () => ({ data: table === "profiles" ? { role: "OWNER", is_active: true }
      : table === "sales" && lookup ? null
      : table === "cashier_shifts" ? { id: "shift", branch_id: "branch" }
      : table === "customers" ? { points: 0, total_spending: 0, category_id: null, customer_categories: null }
      : table === "warehouses" ? null : { id: table === "sales" ? "sale" : "line" }, error: null });
    let lookup = false;
    const query = {
      select: (fields: string) => { lookup = typeof fields === "string" && fields.includes("checkout_fingerprint"); return query; }, eq: () => query, in: () => query, gt: () => query, lte: () => query, not: () => query,
      order: () => query, range: () => query, limit: () => query,
      insert: (value: Record<string, unknown>) => {
        if (table === "sales") state.headers.push(value);
        if (table === "sale_items") state.items.push(value);
        return query;
      },
      update: () => query, delete: () => query,
      single: async () => single(), maybeSingle: async () => single(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, count: Array.isArray(data) ? data.length : 0, error: null }).then(resolve),
    };
    return query;
  },
}) }));
import { checkoutKasir } from "@/app/kasir/checkout";

beforeEach(() => { state.headers = []; state.items = []; });
function bayar(baris: Record<string, unknown>) {
  const data = new FormData();
  Object.entries({ customerId: "customer", metode: "Tunai", bayar: "999999", operationalShiftId: "shift",
    checkout_key: "checkout-promo", cart: JSON.stringify([baris]) }).forEach(([k, v]) => data.set(k, v));
  return checkoutKasir(data).then(() => "ok", (e) => decodeURIComponent(String(e.message)));
}
const BARIS = { item_id: "promo-sku", nama: "Bolt Ikan 800gr", qty: 2, harga: 20000, target_species: "Universal", satuan: "pcs" };

it("menyimpan promo beserta potongannya saat promo yang dipakai", async () => {
  await bayar(BARIS);
  expect(state.items[0]).toMatchObject({ promo_id: "promo-lebaran", promo_discount: 4000 });
  expect(state.headers[0]).toMatchObject({ subtotal: 40000, total: 36000 });
});

it("tidak menempelkan nama promo pada baris yang dimenangkan diskon manual kasir", async () => {
  await bayar({ ...BARIS, item_discount_type: "nominal", item_discount_value: 1000 });
  expect(state.items[0]).toMatchObject({ promo_id: null, promo_discount: 0, item_discount_value: 1000 });
  expect(state.headers[0]).toMatchObject({ subtotal: 40000, total: 39000 });
});

