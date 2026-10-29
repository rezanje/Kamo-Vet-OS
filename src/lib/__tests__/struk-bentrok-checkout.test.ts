import { beforeEach, expect, it, vi } from "vitest";

// Dua kasir membayar pada detik yang sama: nomor struk yang sama dipegang berdua,
// yang kedua ditolak unique constraint. Yang diuji di sini: struknya tetap tersimpan
// sekali dengan nomor lain, tanpa baris atau stok ganda.
const BENTROK = { code: "23505", message: 'duplicate key value violates unique constraint "sales_no_struk_key"' };
const KEY_GANDA = { code: "23505", message: 'duplicate key value violates unique constraint "sales_checkout_key_key"' };

const state = vi.hoisted(() => ({
  attempts: [] as string[], headers: [] as Record<string, unknown>[], items: [] as Record<string, unknown>[],
  stockCalls: 0, finalized: [] as string[], removed: 0,
  rejections: [] as ({ code: string; message: string } | null)[],
  priorOnKeyBentrok: false, prior: null as null | Record<string, unknown>,
}));

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/penjual", () => ({ penjualValid: async () => true }));
// Tiap pembacaan memberi nomor urut baru — persis seperti membaca ulang nomor
// tertinggi sesudah baris lawan ikut terbaca.
vi.mock("@/lib/no-dokumen", async original => ({ ...await original<typeof import("@/lib/no-dokumen")>(),
  nomorBerikutnya: async () => { const seq = state.attempts.length + 1; return { nomor: `POS-2026-${String(seq).padStart(4, "0")}`, prefix: "POS-2026-", digit: 4, seq }; } }));
vi.mock("@/lib/posting", () => ({ postJournal: async () => {} }));
vi.mock("@/lib/quest-hook", () => ({ processQuestProgress: async () => {} }));
vi.mock("@/lib/inventory", () => ({ stockOut: async () => { state.stockCalls++; return { cost: 30000 }; } }));
vi.mock("@/lib/harga-cabang", () => ({ loadHargaCabang: async () => new Map(), hargaCabang: (_map: unknown, _id: string, _unit: string, price: number) => price, applyHargaCabang: (options: unknown) => options }));
vi.mock("@/lib/promo-hitung", async original => ({ ...await original<typeof import("@/lib/promo-hitung")>(), loadPromoAktif: async () => [] }));
vi.mock("@/lib/satuan", async original => ({ ...await original<typeof import("@/lib/satuan")>(), loadUnitOptions: async () => new Map([["item", [{ unit: "pcs", factor: 1, sell_price: 100000, buy_price: 0 }]]]) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (name: string, values: { p_sale_id: string }) => {
    if (name === "refresh_customer_spending") return { data: true, error: null };
    if (name === "cashier_post_stock_atomic") state.stockCalls++;
    state.finalized.push(values.p_sale_id);
    return { data: { sale_id: values.p_sale_id, finalized: true, ...(name === "cashier_post_stock_atomic" ? { checked: true } : {}) }, error: null };
  },
  from(table: string) {
    let lookup = false;
    let salesError: { code: string; message: string } | null = null;
    const data: unknown = table === "items" ? [{ id: "item", nama: "Pakan", name: "Pakan", unit: "pcs", item_type: "Persediaan", sell_price: 100000, buy_price: 30000, min_sell_qty: 1, is_active: true }]
      : table === "stock_layers" ? [{ id: "layer", item_id: "item", qty_left: 5, unit_cost: 30000, exp_date: null, tanggal: "2026-10-29", created_at: "2026-10-29T00:00:00Z" }] : [];
    const single = () => {
      if (table === "sales") return lookup ? { data: state.prior, error: null } : salesError ? { data: null, error: salesError } : { data: { id: "sale" }, error: null };
      return { data: table === "cashier_shifts" ? { id: "shift", branch_id: "branch" }
        : table === "customers" ? { points: 0, total_spending: 0, category_id: null, customer_categories: null }
          : table === "warehouses" ? { id: "warehouse" } : { id: "line" }, error: null };
    };
    const query = {
      select: (fields: string) => { lookup = fields.includes("checkout_fingerprint"); return query; },
      eq: () => query, in: () => query, gt: () => query, lte: () => query, not: () => query, order: () => query, range: () => query, limit: () => query,
      insert: (value: Record<string, unknown>) => {
        if (table === "sales") {
          state.attempts.push(String(value.no_struk));
          salesError = state.rejections.shift() ?? null;
          if (!salesError) { state.headers.push(value); state.prior = { id: "sale", no_struk: value.no_struk, checkout_fingerprint: value.checkout_fingerprint, payments_finalized_at: null }; }
          else if (state.priorOnKeyBentrok) state.prior = { id: "existing", no_struk: "POS-2026-9999", checkout_fingerprint: value.checkout_fingerprint, payments_finalized_at: "2026-10-29T08:00:00Z" };
        }
        if (table === "sale_items") state.items.push({ id: "line", ...value });
        return query;
      },
      update: () => query,
      delete: () => { if (table === "sales") { state.removed++; state.prior = null; } return query; },
      single: async () => single(), maybeSingle: async () => single(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, count: Array.isArray(data) ? data.length : 0, error: null }).then(resolve),
    };
    return query;
  },
}) }));

import { checkoutKasir } from "@/app/kasir/checkout";
import { checkoutSale } from "@/app/(app)/pos/transaksi/actions";

beforeEach(() => {
  state.attempts = []; state.headers = []; state.items = []; state.stockCalls = 0; state.finalized = [];
  state.removed = 0; state.rejections = []; state.priorOnKeyBentrok = false; state.prior = null;
});

function form() {
  const data = new FormData();
  Object.entries({ branchId: "branch", customerId: "customer", salespersonId: "seller", metode: "Tunai", bayar: "100000",
    operationalShiftId: "shift", checkout_key: "checkout-draft",
    cart: JSON.stringify([{ item_id: "item", nama: "Pakan", qty: 1, harga: 100000, target_species: "Universal", satuan: "pcs" }]) })
    .forEach(([key, value]) => data.set(key, value));
  return data;
}

const jalankan = (aksi: (data: FormData) => Promise<void>) => aksi(form()).then(() => "unexpected success", error => error.message as string);

it.each([["kasir", checkoutKasir], ["backoffice", checkoutSale]] as const)(
  "%s menyimpan satu struk dengan nomor berikutnya saat nomor pertama direbut transaksi lain",
  async (_label, aksi) => {
    state.rejections = [BENTROK];

    const outcome = await jalankan(aksi);

    expect(outcome).toContain("/struk/sale");
    expect(state.attempts).toEqual(["POS-2026-0001", "POS-2026-0002"]);
    expect(state.headers).toHaveLength(1);
    expect(state.headers[0]).toMatchObject({ no_struk: "POS-2026-0002", total: 100000 });
    expect(state.items).toHaveLength(1);
    expect(state.stockCalls).toBe(1);
    expect(state.finalized).toEqual(["sale"]);
    expect(state.removed).toBe(0);
  },
);

it.each([["kasir", checkoutKasir], ["backoffice", checkoutSale]] as const)(
  "%s meneruskan jalur 'sudah diproses' saat checkout_key-nya yang bentrok, tanpa membuat struk kedua",
  async (_label, aksi) => {
    state.rejections = [KEY_GANDA];
    state.priorOnKeyBentrok = true;

    const outcome = await jalankan(aksi);

    expect(state.attempts).toHaveLength(1);
    expect(state.headers).toHaveLength(0);
    expect(state.items).toHaveLength(0);
    expect(state.stockCalls).toBe(0);
    expect(outcome).toContain("/struk/existing");
  },
);

it.each([["kasir", checkoutKasir], ["backoffice", checkoutSale]] as const)(
  "%s tidak mengulang penolakan selain nomor struk",
  async (_label, aksi) => {
    state.rejections = [{ code: "42501", message: "new row violates row-level security policy" }];

    const outcome = await jalankan(aksi);

    expect(state.attempts).toHaveLength(1);
    expect(state.headers).toHaveLength(0);
    expect(state.items).toHaveLength(0);
    expect(state.stockCalls).toBe(0);
    expect(outcome).not.toContain("/struk/");
    expect(outcome).toContain("row-level%20security");
  },
);

it.each([["kasir", checkoutKasir], ["backoffice", checkoutSale]] as const)(
  "%s menampilkan pesan bahasa manusia, bukan error database, saat semua nomor tetap bentrok",
  async (_label, aksi) => {
    state.rejections = Array.from({ length: 5 }, () => BENTROK);

    const outcome = await jalankan(aksi);

    expect(state.attempts).toHaveLength(5);
    expect(new Set(state.attempts).size).toBe(5);
    expect(state.headers).toHaveLength(0);
    expect(state.items).toHaveLength(0);
    expect(state.stockCalls).toBe(0);
    expect(outcome).not.toContain("/struk/");
    expect(outcome).not.toContain("23505");
    expect(outcome).not.toContain("sales_no_struk_key");
    expect(decodeURIComponent(outcome)).toContain("Nomor struk sedang dipakai transaksi lain. Coba simpan lagi; transaksi ini belum tersimpan dan stok belum keluar.");
  },
);

it("kasir menyimpan sekali saja walau dua nomor beruntun sama-sama direbut", async () => {
  state.rejections = [BENTROK, BENTROK];

  const outcome = await jalankan(checkoutKasir);

  expect(outcome).toContain("/kasir/struk/sale");
  expect(state.attempts).toEqual(["POS-2026-0001", "POS-2026-0002", "POS-2026-0003"]);
  expect(state.headers).toHaveLength(1);
  expect(state.items).toHaveLength(1);
  expect(state.stockCalls).toBe(1);
});
