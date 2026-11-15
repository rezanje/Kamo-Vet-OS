import { describe, expect, it } from "vitest";
import { bacaHeaderGroomer, headerGroomer, idGroomerKunjungan, kunjunganTampakGrooming } from "./groomer-kunjungan";
import type { KartuPetugas } from "./petugas-cetak";

const kartu = new Map<string, KartuPetugas>([
  ["ilham", { nama: "DRH. ILHAM", jabatan: "Dokter Hewan" }],
  ["agung", { nama: "Agung", jabatan: "Groomer" }],
  ["bima", { nama: "Bima", jabatan: "Groomer Senior" }],
  ["kasir", { nama: "Rina", jabatan: "Kasir" }],
  ["kosong", { nama: "Tanpa Jabatan", jabatan: null }],
]);
const umumGrooming = { poli: "Poli Umum", keluhan: "Grooming", doctor_id: "ilham", dokter: "DRH. ILHAM", service_provider_id: null };
const jasaGrooming = (staff: Record<string, string | null> = {}) => ({
  item_type: "Jasa", tindakan_kategori: "Konsultasi", deskripsi: "Grooming VET Lengkap + CU",
  service_performers: { doctor_id: "ilham", doctor_name: "DRH. ILHAM", staff_id: null, staff_name: null, ...staff },
});

describe("headerGroomer", () => {
  it("visit Belang (Poli Umum, keluhan Grooming, groomer kosong) -> 'belum diisi'", () => {
    expect(headerGroomer(umumGrooming, [jasaGrooming()], kartu)).toEqual({ label: "Groomer", nama: null });
  });
  it("groomer dari visits.service_provider_id", () => {
    expect(headerGroomer({ ...umumGrooming, service_provider_id: "agung" }, [], kartu)).toEqual({ label: "Groomer", nama: "Agung" });
  });
  it("groomer dari snapshot pelaksana baris invoice (nama tersimpan menang)", () => {
    expect(headerGroomer(umumGrooming, [jasaGrooming({ staff_id: "agung", staff_name: "Agung (snapshot)" })], kartu))
      .toEqual({ label: "Groomer", nama: "Agung (snapshot)" });
  });
  it("beberapa groomer: gabungan unik, satu orang sekali", () => {
    const r = headerGroomer({ ...umumGrooming, service_provider_id: "agung" },
      [jasaGrooming({ staff_id: "agung", staff_name: "Agung" }), jasaGrooming({ staff_id: "bima", staff_name: "Bima" })], kartu);
    expect(r).toEqual({ label: "Groomer", nama: "Agung, Bima" });
  });
  it("dokter dan kasir bukan groomer: tetap 'belum diisi'", () => {
    expect(headerGroomer(umumGrooming, [jasaGrooming({ staff_id: "kasir", staff_name: "Rina" })], kartu)).toEqual({ label: "Groomer", nama: null });
  });
  it("poli Grooming: PJ kunjungan = groomer; pelaksana kunjungan tanpa jabatan tetap dihitung", () => {
    expect(headerGroomer({ poli: "Grooming", doctor_id: "agung", dokter: "Agung", service_provider_id: null }, [], kartu)).toEqual({ label: "Groomer", nama: "Agung" });
    expect(headerGroomer({ poli: "Grooming", doctor_id: null, dokter: null, service_provider_id: "kosong" }, [], kartu)).toEqual({ label: "Groomer", nama: "Tanpa Jabatan" });
  });
  it("kunjungan non-grooming tidak menampilkan apa pun", () => {
    expect(headerGroomer({ poli: "Poli Umum", keluhan: "Batuk", doctor_id: "ilham", dokter: "DRH. ILHAM" }, [
      { item_type: "Jasa", tindakan_kategori: "Konsultasi", deskripsi: "Konsultasi dokter", service_performers: { doctor_id: "ilham", staff_id: null } },
      { item_type: "Persediaan", tindakan_kategori: null, deskripsi: "Shampoo grooming 100 ml", service_performers: null },
    ], kartu)).toBeNull();
    expect(headerGroomer({ poli: "Poli Umum", keluhan: null }, [], kartu)).toBeNull();
  });
  it("tanda grooming: poli, keluhan (huruf besar/kecil), jasa grooming di tagihan; barang bernama grooming tidak", () => {
    expect(kunjunganTampakGrooming({ poli: "Grooming" }, [])).toBe(true);
    expect(kunjunganTampakGrooming({ poli: "Poli Umum", keluhan: "mau GROOMING + vaksin" }, [])).toBe(true);
    expect(kunjunganTampakGrooming({ poli: "Vaksinasi" }, [{ item_type: "Jasa", tindakan_kategori: "Grooming", deskripsi: "Mandi" }])).toBe(true);
    expect(kunjunganTampakGrooming({ poli: "Vaksinasi" }, [{ item_type: "Jasa", tindakan_kategori: "Konsultasi", deskripsi: "Grooming Lengkap" }])).toBe(true);
    expect(kunjunganTampakGrooming({ poli: "Vaksinasi" }, [{ item_type: "Persediaan", tindakan_kategori: null, deskripsi: "Shampoo Grooming" }])).toBe(false);
  });
  it("kunjungan legacy/arsip: nama tetap tampil bila ada, tetapi tidak ditandai 'belum diisi'", () => {
    expect(headerGroomer({ ...umumGrooming, legacy_source_key: "impor:1" }, [], kartu)).toBeNull();
    expect(headerGroomer({ ...umumGrooming, archived_at: "2026-11-11T00:00:00Z" }, [], kartu)).toBeNull();
    expect(headerGroomer({ ...umumGrooming, legacy_source_key: "impor:1" }, [jasaGrooming({ staff_id: "agung", staff_name: "Agung" })], kartu)).toEqual({ label: "Groomer", nama: "Agung" });
  });
  it("kunjungan grooming dengan pelaksana non-dokter non-groomer: label Pelaksana", () => {
    expect(headerGroomer({ ...umumGrooming, service_provider_id: "kasir" }, [], kartu)).toEqual({ label: "Pelaksana", nama: "Rina" });
  });
  it("pelaksana kunjungan terisi tapi kartu tidak terbaca: tidak mengaku 'belum diisi'", () => {
    expect(headerGroomer({ ...umumGrooming, service_provider_id: "hilang" }, [], kartu)).toBeNull();
  });
  it("id karyawan yang dibaca mencakup pelaksana kunjungan", () => {
    expect(idGroomerKunjungan({ ...umumGrooming, service_provider_id: "agung" }, [jasaGrooming({ staff_id: "bima" })]).sort()).toEqual(["agung", "bima", "ilham"]);
  });
});

function client(opts: { invoices?: unknown; invoiceError?: boolean; employeesError?: boolean }) {
  const calls: string[] = [];
  const chain = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in"]) q[m] = (...a: unknown[]) => { calls.push(`${table}.${m}:${JSON.stringify(a)}`); return q; };
    q.then = (res: (v: unknown) => unknown) => res(table === "invoices"
      ? { data: opts.invoiceError ? null : opts.invoices, error: opts.invoiceError ? { message: "x" } : null }
      : { data: opts.employeesError ? null : [{ id: "agung", nama: "Agung", jabatan: "Groomer" }, { id: "ilham", nama: "DRH. ILHAM", jabatan: "Dokter" }], error: opts.employeesError ? { message: "x" } : null });
    return q;
  };
  return { calls, from: (t: string) => chain(t) };
}
const invoice = (lines: unknown[]) => [{ id: "inv-1", invoice_items: lines }];

describe("bacaHeaderGroomer", () => {
  const visit = { id: "v1", ...umumGrooming };
  it("hanya tagihan tidak void dibaca, snapshot pelaksana dipakai", async () => {
    const c = client({ invoices: invoice([{ deskripsi: "Grooming", service_performers: { doctor_id: "ilham", staff_id: "agung", staff_name: "Agung" }, items: { item_type: "Jasa", tindakan_kategori: "Konsultasi" } }]) });
    expect(await bacaHeaderGroomer(c, visit)).toEqual({ label: "Groomer", nama: "Agung" });
    expect(c.calls.some((x) => x.startsWith("invoices.is") && x.includes("voided_at"))).toBe(true);
  });
  it("Belang: jasa grooming tanpa staf -> belum diisi", async () => {
    const c = client({ invoices: invoice([{ deskripsi: "Grooming VET Lengkap + CU", service_performers: { doctor_id: "ilham", staff_id: null }, items: [{ item_type: "Jasa", tindakan_kategori: "Konsultasi" }] }]) });
    expect(await bacaHeaderGroomer(c, visit)).toEqual({ label: "Groomer", nama: null });
  });
  it("gagal baca = baris tidak tampil, tidak melempar", async () => {
    expect(await bacaHeaderGroomer(client({ invoiceError: true }), visit)).toBeNull();
    expect(await bacaHeaderGroomer(client({ invoices: invoice([]), employeesError: true }), visit)).toBeNull();
  });
});
