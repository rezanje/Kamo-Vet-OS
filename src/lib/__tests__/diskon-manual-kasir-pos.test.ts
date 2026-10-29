import { beforeEach, expect, it, vi } from "vitest";

// Keputusan pemilik 29 Okt 2026: kasir tidak boleh memasang diskon manual.
// Dua jalur POS diuji di sini — kasir petshop (/kasir) dan POS back-office.
const state = vi.hoisted(() => ({
  peran: "STAFF" as string | null, aktif: true, diskonDefault: 0,
  headers: [] as Record<string, unknown>[], items: [] as Record<string, unknown>[],
}));

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "POS-DISKON-UJI" }) }));
vi.mock("@/lib/quest-hook", () => ({ processQuestProgress: async () => {} }));
vi.mock("@/lib/customer-tier", () => ({ recomputeCustomerTier: async () => true }));
vi.mock("@/lib/inventory", () => ({ stockOut: async () => ({ cost: 0 }) }));
vi.mock("@/lib/harga-cabang", () => ({
  loadHargaCabang: async () => new Map(),
  hargaCabang: (_m: unknown, _i: string, _u: string, price: number) => price,
  applyHargaCabang: (options: unknown) => options,
}));
vi.mock("@/lib/promo-hitung", async original => ({ ...await original<typeof import("@/lib/promo-hitung")>(), loadPromoAktif: async () => [] }));
vi.mock("@/lib/satuan", async original => ({
  ...await original<typeof import("@/lib/satuan")>(),
  loadUnitOptions: async () => new Map([["item", [{ unit: "pcs", factor: 1, sell_price: 100000, buy_price: 0 }]]]),
}));
vi.mock("@/lib/service-performers-server", () => ({
  loggedInCashier: async () => ({ employeeId: null, name: "Kasir Uji" }),
  validateServicePerformerRows: async (_c: unknown, _b: string, rows: unknown[]) => rows.map(() => null),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "aktor" } } }) },
  rpc: async (name: string, values: { p_sale_id: string }) => {
    if (name !== "finalize_pos_sale" && name !== "cashier_post_stock_atomic") return { data: true, error: null };
    return { data: { sale_id: values.p_sale_id, journal_id: "jurnal", finalized: true, checked: true }, error: null };
  },
  from(table: string) {
    // Pencarian draft (checkout_fingerprint) harus mengembalikan "belum ada",
    // bukan struk lama — kalau tidak, aksi berhenti sebelum memeriksa diskon.
    let lookup = false;
    let data: unknown = table === "items"
      ? [{ id: "item", nama: "Pakan", name: "Pakan", unit: "pcs", item_type: "Jasa", sell_price: 100000,
           buy_price: 0, min_sell_qty: 1, default_discount: state.diskonDefault, is_active: true }]
      : [];
    const single = () => ({ data:
      table === "profiles" ? (state.peran ? { role: state.peran, is_active: state.aktif } : null)
      : table === "role_capabilities" ? null
      : table === "cashier_shifts" ? { id: "shift", branch_id: "branch" }
      : table === "customers" ? { points: 0, total_spending: 0, category_id: null, customer_categories: null }
      : table === "warehouses" ? null
      : table === "sales" && lookup ? null
      : { id: table === "sales" ? "sale" : "line" }, error: null });
    const query = {
      select: (fields?: string) => { lookup = !!fields?.includes("checkout_fingerprint"); return query; }, eq: () => query, in: () => query, is: () => query, gt: () => query, lte: () => query,
      not: () => query, order: () => query, range: () => query, limit: () => query,
      insert: (value: Record<string, unknown>) => {
        if (table === "sales") { state.headers.push(value); data = value; }
        if (table === "sale_items") state.items.push({ id: "line", ...value });
        return query;
      },
      update: () => query, delete: () => query,
      single: async () => single(), maybeSingle: async () => single(),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data, count: Array.isArray(data) ? data.length : 0, error: null }).then(resolve),
    };
    return query;
  },
}) }));

import { checkoutKasir } from "@/app/kasir/checkout";
import { checkoutSale } from "@/app/(app)/pos/transaksi/actions";
import { PESAN_DISKON_MANUAL } from "../akses-diskon";

beforeEach(() => { state.peran = "STAFF"; state.aktif = true; state.diskonDefault = 0; state.headers = []; state.items = []; });

type Baris = Record<string, unknown>;
function kasir(opsi: { diskon?: number; baris?: Baris } = {}) {
  const data = new FormData();
  Object.entries({
    customerId: "customer", metode: "Tunai", bayar: "100000", operationalShiftId: "shift",
    checkout_key: "checkout-diskon", diskon: String(opsi.diskon ?? 0),
    cart: JSON.stringify([{ item_id: "item", nama: "Pakan", qty: 1, harga: 100000, target_species: "Universal", satuan: "pcs", ...(opsi.baris ?? {}) }]),
  }).forEach(([k, v]) => data.set(k, v));
  return data;
}
function pos(discount: number) {
  const data = new FormData();
  Object.entries({
    branchId: "branch", metode: "Tunai", bayar: "100000", checkout_key: "checkout-pos", discount: String(discount),
    cart: JSON.stringify([{ item_id: "item", nama: "Pakan", qty: 1, harga: 100000, target_species: "Universal", satuan: "pcs" }]),
  }).forEach(([k, v]) => data.set(k, v));
  return data;
}
const jalankan = (p: Promise<unknown>) => p.then(() => "sukses tak terduga", (error: Error) => decodeURIComponent(error.message));

it("kasir petshop: diskon nota dari akun tanpa hak ditolak sebelum struk dibuat", async () => {
  expect(await jalankan(checkoutKasir(kasir({ diskon: 15000 })))).toContain(PESAN_DISKON_MANUAL);
  expect(state.headers).toHaveLength(0);
});

it("kasir petshop: potongan per baris dari akun tanpa hak ditolak", async () => {
  const hasil = await jalankan(checkoutKasir(kasir({ baris: { item_discount_type: "nominal", item_discount_value: 5000 } })));
  expect(hasil).toContain(PESAN_DISKON_MANUAL);
  expect(state.items).toHaveLength(0);
});

it("kasir petshop: dokter juga tidak boleh, pemilik boleh", async () => {
  state.peran = "DOCTOR";
  expect(await jalankan(checkoutKasir(kasir({ diskon: 15000 })))).toContain(PESAN_DISKON_MANUAL);
  state.peran = "OWNER";
  expect(await jalankan(checkoutKasir(kasir({ diskon: 15000 })))).toContain("/kasir/struk/sale");
  expect(state.headers[0]).toMatchObject({ manual_discount: 15000, manual_discount_by: "aktor", total: 85000 });
});

it("kasir petshop: akun nonaktif atau profil tak terbaca ikut ditolak (gagal tertutup)", async () => {
  state.peran = "OWNER"; state.aktif = false;
  expect(await jalankan(checkoutKasir(kasir({ diskon: 1 })))).toContain(PESAN_DISKON_MANUAL);
  state.peran = null; state.aktif = true;
  expect(await jalankan(checkoutKasir(kasir({ diskon: 1 })))).toContain(PESAN_DISKON_MANUAL);
});

it("kasir petshop: diskon default barang tetap jalan untuk kasir dan ditetapkan ulang dari master", async () => {
  state.diskonDefault = 20;
  // Layar mengirim diskon default apa adanya — bukan diskon manual.
  const hasil = await jalankan(checkoutKasir(kasir({ baris: { item_discount_type: "percent", item_discount_value: 20 } })));
  expect(hasil).toContain("/kasir/struk/sale");
  expect(state.items[0]).toMatchObject({ item_discount_type: "percent", item_discount_value: 20 });
  expect(state.headers[0]).toMatchObject({ manual_discount: 0, manual_discount_by: null });
});

it("kasir petshop: diskon default yang ditinggikan dari layar ditolak (temuan audit S-6)", async () => {
  state.diskonDefault = 20;
  const hasil = await jalankan(checkoutKasir(kasir({ baris: { item_discount_type: "percent", item_discount_value: 90 } })));
  expect(hasil).toContain(PESAN_DISKON_MANUAL);
  expect(state.headers).toHaveLength(0);
});

it("kasir petshop: pemilik tetap boleh mengetik potongan baris sendiri", async () => {
  // Barang ini tidak punya diskon default, jadi potongannya murni manual.
  state.peran = "OWNER";
  await jalankan(checkoutKasir(kasir({ baris: { item_discount_type: "percent", item_discount_value: 10 } })));
  expect(state.items[0]).toMatchObject({ item_discount_type: "percent", item_discount_value: 10 });
});

it("POS back-office: diskon nota dari akun tanpa hak ditolak, pemilik boleh", async () => {
  expect(await jalankan(checkoutSale(pos(25000)))).toContain(PESAN_DISKON_MANUAL);
  expect(state.headers).toHaveLength(0);
  state.peran = "FINANCE";
  expect(await jalankan(checkoutSale(pos(25000)))).toContain("/pos/struk/sale");
  expect(state.headers[0]).toMatchObject({ manual_discount: 25000, voucher_discount: 0, manual_discount_by: "aktor" });
});

it("POS back-office: transaksi tanpa diskon tidak terganggu", async () => {
  expect(await jalankan(checkoutSale(pos(0)))).toContain("/pos/struk/sale");
  expect(state.headers[0]).toMatchObject({ manual_discount: 0, manual_discount_by: null });
});
