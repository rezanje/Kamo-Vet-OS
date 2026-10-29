import { beforeEach, expect, it, vi } from "vitest";
import { kumpulkanBarisKomisi } from "@/lib/komisi-data";
import { atribusiPenjual, rekapTenagaPenjual } from "@/lib/laporan-tenaga-penjual";

// Fixture fiktif: tidak ada data pelanggan, karyawan, atau tarif asli di sini.

const state = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  allowed: null as string[] | null,
}));

vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => state.allowed }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "pengguna" } } }) },
    from(table: string) {
      const data = state.tables[table] ?? [];
      const hasil = { data, count: data.length, error: null };
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q, is: () => q, not: () => q, neq: () => q,
        gte: () => q, lte: () => q, in: () => q, order: () => q,
        range: async () => hasil,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(hasil).then(resolve),
      };
      return q;
    },
  }),
}));

import { ambilTenagaPenjual } from "./data";

const RENTANG = { dari: "2026-10-01", sampai: "2026-10-31" };

const visit = {
  branch_id: "cabang", doctor_id: "dokter",
  branches: { name: "Cabang Uji" }, customers: { name: "Pemilik Fiktif" }, pets: { name: "Milo" },
};
const invoiceDiskon = {
  id: "inv", visit_id: "visit", invoice_no: "INV-1", created_at: "2026-10-20T03:00:00Z",
  total: 90, salesperson_id: null, visits: visit,
};

beforeEach(() => {
  state.allowed = null;
  state.tables = {
    employees: [
      { id: "dokter", nama: "Drh. Fiktif", jabatan: "Dokter", status: "Aktif", profile_id: "profil-dokter", branches: { name: "Cabang Uji" } },
      { id: "perawat", nama: "Perawat Fiktif", jabatan: "Perawat", status: "Aktif", profile_id: null, branches: { name: "Cabang Uji" } },
      { id: "kasir", nama: "Kasir Fiktif", jabatan: "Kasir", status: "Aktif", profile_id: "profil-kasir", branches: { name: "Cabang Uji" } },
    ],
    branches: [{ id: "cabang", name: "Cabang Uji" }, { id: "cabang-lain", name: "Cabang Lain" }],
  };
});

it("membagi potongan kepala tagihan klinik persis seperti laporan komisi", async () => {
  const items = [
    { id: "baris-a", deskripsi: "Jasa A", qty: 1, harga: 60, jenis: "jasa", item_id: null, compound_recipe_id: null, service_performers: null, salesperson_id: null, invoices: invoiceDiskon },
    { id: "baris-b", deskripsi: "Obat B", qty: 1, harga: 40, jenis: "obat", item_id: "obat", compound_recipe_id: null, service_performers: null, salesperson_id: null, invoices: invoiceDiskon },
  ];
  state.tables.invoice_items = items;
  const laporan = await ambilTenagaPenjual(RENTANG);

  // Dokumen yang sama dibaca laporan komisi lewat bentuk barisnya sendiri.
  const komisi = await kumpulkanBarisKomisi({
    from(table: string) {
      const data = table === "invoices" ? [{
        ...invoiceDiskon, paid_at: "2026-10-20T03:00:00Z",
        visits: { branch_id: "cabang", doctor_id: "dokter" },
        invoice_items: items.map((it) => ({ id: it.id, item_id: it.item_id, qty: it.qty, harga: it.harga, hpp: null, service_performers: null, salesperson_id: null })),
      }] : [];
      const hasil = { data, count: data.length, error: null };
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q, is: () => q, not: () => q, neq: () => q, gte: () => q, lte: () => q,
        in: () => q, order: () => q, range: async () => hasil,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(hasil).then(resolve),
      };
      return q;
    },
  }, "2026-10");

  expect(laporan.rows.map((row) => row.netto)).toEqual([54, 36]);
  expect(laporan.rows.map((row) => row.netto)).toEqual(komisi.baris.map((row) => row.omzet));
  // Jumlah baris menutup total dokumen, jadi laporan bisa dibandingkan dengan laporan omzet.
  expect(laporan.rows.reduce((jumlah, row) => jumlah + row.netto, 0)).toBe(90);
  expect(laporan.selisihDokumen).toBe(0);
});

it("menghitung baris dua pelaksana untuk keduanya tanpa melipatgandakan total perusahaan", async () => {
  state.tables.invoice_items = [{
    id: "baris", deskripsi: "Operasi", qty: 1, harga: 200, jenis: "jasa", item_id: null, compound_recipe_id: null,
    service_performers: { version: 1, doctor_id: "dokter", staff_id: "perawat" }, salesperson_id: null,
    invoices: { ...invoiceDiskon, total: 200 },
  }];
  const { rows } = await ambilTenagaPenjual(RENTANG);
  expect(rows[0]).toMatchObject({ dokterId: "dokter", stafId: "perawat", penjualId: null, netto: 200, jenis: "Jasa" });

  const { orang, total } = rekapTenagaPenjual(atribusiPenjual(rows));
  expect(orang.map((r) => [r.employeeId, r.netto])).toEqual([["dokter", 200], ["perawat", 200]]);
  expect(total.netto).toBe(200);
});

it("memakai penjual SKU lama, lalu dokter PJ kunjungan, untuk tagihan tanpa atribusi baris", async () => {
  state.tables.invoice_items = [
    { id: "lama", deskripsi: "Obat", qty: 1, harga: 100, jenis: "obat", item_id: "obat", compound_recipe_id: null, service_performers: null, salesperson_id: "kasir", invoices: { ...invoiceDiskon, total: 200 } },
    { id: "pj", deskripsi: "Periksa", qty: 1, harga: 100, jenis: "jasa", item_id: null, compound_recipe_id: null, service_performers: null, salesperson_id: null, invoices: { ...invoiceDiskon, total: 200 } },
  ];
  const { rows } = await ambilTenagaPenjual(RENTANG);
  expect(rows[0]).toMatchObject({ penjualId: "kasir", dokterId: null });
  expect(rows[1]).toMatchObject({ penjualId: null, dokterId: "dokter" });
});

it("mengurangi retur kasir dari pemilik baris asalnya dan tidak menebak sumber yang tidak pasti", async () => {
  const sale = {
    id: "struk", branch_id: "cabang", no_struk: "POS-1", created_at: "2026-10-21T03:00:00Z",
    total: 300, merchant_fee_total: 0, salesperson_id: null, cashier_id: "profil-kasir",
    payment_plan: null, payments_finalized_at: null, voided_at: null,
    branches: { name: "Cabang Uji" }, customers: { name: "Pemilik Fiktif" },
  };
  state.tables.sale_items = [
    { id: "jual-a", nama: "Pakan", qty: 2, harga: 100, item_discount_type: null, item_discount_value: 0, promo_discount: 0, service_performers: { version: 1, doctor_id: null, staff_id: "perawat" }, sales: sale },
    { id: "jual-b", nama: "Vitamin", qty: 1, harga: 100, item_discount_type: null, item_discount_value: 0, promo_discount: 0, service_performers: null, sales: sale },
  ];
  state.tables.sales_returns = [{
    id: "retur", sale_id: "struk", tanggal: "2026-10-25",
    sales_return_items: [
      { id: "retur-a", source_line_id: "jual-a", nama: "Pakan", qty: 1, harga: 100 },
      { id: "retur-x", source_line_id: null, nama: "Tak jelas", qty: 1, harga: 50 },
    ],
  }];

  const { rows, returTanpaSumber } = await ambilTenagaPenjual(RENTANG);
  const { orang, tanpaPenjual, total } = rekapTenagaPenjual(atribusiPenjual(rows));
  expect(orang.find((r) => r.employeeId === "perawat")?.netto).toBe(100);
  expect(orang.find((r) => r.employeeId === "kasir")?.netto).toBe(100);
  // Retur yang baris asalnya tidak pasti tidak dibebankan ke siapa pun.
  expect(returTanpaSumber).toBe(50);
  expect(tanpaPenjual?.netto).toBe(-50);
  expect(total.netto).toBe(150);
});

it("membuang faktur grosir yang tidak dihitung omzet dan memakai pembuat faktur sebagai penjual", async () => {
  const dasar = { branch_id: "cabang", tanggal: "2026-10-10", status: "berjalan", voided_on: null, opening_batch_id: null, replaces_invoice_id: null, created_by: "profil-kasir", branches: { name: "Cabang Uji" }, customers: { name: "Toko Fiktif" } };
  state.tables.sales_invoice_items = [
    { id: "g1", nama: "Pakan dus", qty: 2, harga: 500, diskon: 0, sales_invoices: { ...dasar, id: "f1", no_faktur: "FJ-1", kategori: "umum" } },
    { id: "g2", nama: "Selisih", qty: 1, harga: 900, diskon: 0, sales_invoices: { ...dasar, id: "f2", no_faktur: "FJ-2", kategori: "selisih_stok" } },
    { id: "g3", nama: "Batal", qty: 1, harga: 700, diskon: 0, sales_invoices: { ...dasar, id: "f3", no_faktur: "FJ-3", kategori: "umum", status: "batal" } },
  ];
  const { rows } = await ambilTenagaPenjual(RENTANG);
  expect(rows.map((row) => row.dokumen)).toEqual(["FJ-1"]);
  expect(rows[0]).toMatchObject({ kanal: "Grosir", penjualId: "kasir", netto: 1000 });
});

it("tidak menampilkan baris cabang yang tidak boleh dibuka pengguna", async () => {
  state.allowed = ["cabang-lain"];
  state.tables.invoice_items = [{
    id: "baris", deskripsi: "Periksa", qty: 1, harga: 100, jenis: "jasa", item_id: null, compound_recipe_id: null,
    service_performers: null, salesperson_id: null, invoices: { ...invoiceDiskon, total: 100 },
  }];
  const { rows, cabangOptions } = await ambilTenagaPenjual(RENTANG);
  expect(rows).toEqual([]);
  expect(cabangOptions.map((c) => c.id)).toEqual(["cabang-lain"]);
});

it("menolak rentang tanggal yang tidak masuk akal tanpa membaca database", async () => {
  const hasil = await ambilTenagaPenjual({ dari: "2026-10-31", sampai: "2026-10-01" });
  expect(hasil.rows).toEqual([]);
  expect(hasil.pesanError).toContain("Rentang tanggal tidak valid");
});
