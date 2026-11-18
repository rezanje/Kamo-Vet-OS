import { beforeEach, expect, it, vi } from "vitest";
import { kumpulkanBarisKomisi } from "@/lib/komisi-data";
import { atribusiPenjual, rekapTenagaPenjual } from "@/lib/laporan-tenaga-penjual";

// Ubah dokter PJ -> laporan Tenaga Penjual dan Komisi. Kedua laporan membaca tabel LANGSUNG (tanpa snapshot/cache):
// baris tagihan dengan pelaksana tersimpan tetap milik pelaksananya; baris tanpa pelaksana/penjual mengikuti visits.doctor_id.
// Tes ini membaca laporan SEBELUM dan SESUDAH mengganti dokter kunjungan (baris yang sama, hanya dokter kunjungan berubah) dan
// membuktikan: omzet dokter lama turun tepat sejumlah yang berpindah, dokter baru naik sama, total tidak berubah.
// Sisi database (baris mana yang boleh berubah) dibuktikan scripts/test-ubah-dokter-pj-postgres.py. Semua data fiktif.

const state = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "pengguna" } } }) },
    from(table: string) {
      const data = state.tables[table] ?? [];
      const hasil = { data, count: data.length, error: null };
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q, is: () => q, not: () => q, neq: () => q, gte: () => q, lte: () => q, in: () => q, order: () => q,
        range: async () => hasil, then: (resolve: (value: unknown) => unknown) => Promise.resolve(hasil).then(resolve),
      };
      return q;
    },
  }),
}));

import { ambilTenagaPenjual } from "./data";

const RENTANG = { dari: "2026-11-01", sampai: "2026-11-30" };
const kunjungan = (doctorId: string) => ({
  branch_id: "cabang", doctor_id: doctorId, branches: { name: "Cabang Uji" }, customers: { name: "Pemilik Fiktif" }, pets: { name: "Bubel" },
});
const faktur = (doctorId: string) => ({
  id: "inv", visit_id: "visit", invoice_no: "INV-1", created_at: "2026-11-17T03:00:00Z", total: 300, salesperson_id: null, visits: kunjungan(doctorId),
});
// Tiga baris: obat tanpa pelaksana (mengikuti dokter kunjungan, 100), jasa berpelaksana ILHAM eksplisit (120), jasa berpelaksana AINI eksplisit (80).
const baris = (doctorId: string) => [
  { id: "obat", deskripsi: "Obat tanpa pelaksana", qty: 1, harga: 100, jenis: "obat", item_id: "obat", compound_recipe_id: null, service_performers: null, salesperson_id: null, invoices: faktur(doctorId) },
  { id: "jasa-ilham", deskripsi: "Jasa eksplisit Ilham", qty: 1, harga: 120, jenis: "jasa", item_id: null, compound_recipe_id: null, service_performers: { version: 1, doctor_id: "ilham", staff_id: null }, salesperson_id: null, invoices: faktur(doctorId) },
  { id: "jasa-aini", deskripsi: "Jasa eksplisit Aini", qty: 1, harga: 80, jenis: "jasa", item_id: null, compound_recipe_id: null, service_performers: { version: 1, doctor_id: "aini", staff_id: null }, salesperson_id: null, invoices: faktur(doctorId) },
];

beforeEach(() => {
  state.tables = {
    employees: [
      { id: "ilham", nama: "DRH. ILHAM", jabatan: "Dokter Hewan Poli", status: "Aktif", profile_id: null, branches: { name: "Cabang Uji" } },
      { id: "aini", nama: "DRH LUTHFIAH RUSYDA AINI", jabatan: "Dokter", status: "Aktif", profile_id: null, branches: { name: "Cabang Uji" } },
    ],
    branches: [{ id: "cabang", name: "Cabang Uji" }],
  };
});

async function totalPerDokter(doctorId: string) {
  state.tables.invoice_items = baris(doctorId);
  const { rows } = await ambilTenagaPenjual(RENTANG);
  const { orang, total } = rekapTenagaPenjual(atribusiPenjual(rows));
  return { per: Object.fromEntries(orang.map((r) => [r.employeeId, r.netto])), total: total.netto };
}

it("laporan Tenaga Penjual: setelah dokter kunjungan Ilham -> Aini, baris berbasis kunjungan pindah tepat 100; baris eksplisit tetap; total tetap", async () => {
  const sebelum = await totalPerDokter("ilham");
  expect(sebelum.per).toEqual({ ilham: 100 + 120, aini: 80 });
  const sesudah = await totalPerDokter("aini");
  expect(sesudah.per).toEqual({ ilham: 120, aini: 80 + 100 });
  expect(sebelum.per.ilham - sesudah.per.ilham).toBe(100);
  expect(sesudah.per.aini - sebelum.per.aini).toBe(100);
  expect(sesudah.total).toBe(sebelum.total);
  expect(sesudah.total).toBe(300);
});

it("laporan Tenaga Penjual: baris resep yang diikutkan (pelaksana lama -> baru) membuat tagihan yang terbit sesudahnya mengkredit hanya dokter baru", async () => {
  // Tagihan terbit SETELAH koreksi: baris yang dulu Ilham kini tersalin sebagai Aini dari resep; tidak ada baris Ilham lagi.
  state.tables.invoice_items = baris("aini").map((b) => (b.id === "jasa-ilham" ? { ...b, service_performers: { version: 1, doctor_id: "aini", staff_id: null } } : b));
  const { rows } = await ambilTenagaPenjual(RENTANG);
  const { orang, total } = rekapTenagaPenjual(atribusiPenjual(rows));
  expect(Object.fromEntries(orang.map((r) => [r.employeeId, r.netto]))).toEqual({ aini: 300 });
  expect(total.netto).toBe(300);
});

it("laporan Komisi membaca sumber yang sama: baris tanpa pelaksana mengikuti dokter kunjungan saat ini; pelaksana tersimpan tidak bergeser", async () => {
  const komisiUntuk = async (doctorId: string) => {
    const items = baris(doctorId);
    const hasil = await kumpulkanBarisKomisi({
      from(table: string) {
        const data = table === "invoices" ? [{
          ...faktur(doctorId), paid_at: "2026-11-17T03:00:00Z", visits: { branch_id: "cabang", doctor_id: doctorId },
          invoice_items: items.map((it) => ({ id: it.id, item_id: it.item_id, qty: it.qty, harga: it.harga, hpp: null, service_performers: it.service_performers, salesperson_id: null })),
        }] : [];
        const res = { data, count: data.length, error: null };
        const q: Record<string, unknown> = {
          select: () => q, eq: () => q, is: () => q, not: () => q, neq: () => q, gte: () => q, lt: () => q, lte: () => q, in: () => q, order: () => q,
          range: async () => res, then: (resolve: (value: unknown) => unknown) => Promise.resolve(res).then(resolve),
        };
        return q;
      },
    }, "2026-11");
    const per: Record<string, number> = {};
    for (const b of hasil.baris) per[String(b.employeeId)] = (per[String(b.employeeId)] ?? 0) + b.omzet;
    return per;
  };
  const sebelum = await komisiUntuk("ilham");
  const sesudah = await komisiUntuk("aini");
  expect(sebelum).toEqual({ ilham: 220, aini: 80 });
  expect(sesudah).toEqual({ ilham: 120, aini: 180 });
  expect(Object.values(sesudah).reduce((a, b) => a + b, 0)).toBe(Object.values(sebelum).reduce((a, b) => a + b, 0));
});
