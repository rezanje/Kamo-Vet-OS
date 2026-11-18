import { describe, expect, it } from "vitest";
import {
  bacaPemeriksaId, dokterAwalKasir, pemeriksaBerlaku, periksaPemeriksa, pilihanPemeriksa, poliPakaiPemeriksa,
} from "@/lib/dokter-pemeriksa";

const ID = "0f2b6c1e-8a43-4d2a-9b7e-1c5d3e7f9a10";
const staf = [
  { id: "d1", nama: "drh. Aini", jabatan: "Dokter Hewan Poli", jaga: true },
  { id: "g1", nama: "Agung", jabatan: "Staff Toko - Groomer" },
  { id: "p1", nama: "Sari", jabatan: "Paramedis" },
  { id: "a1", nama: "Asisten", jabatan: "Asisten Dokter Hewan" },
  { id: "d2", nama: "drh. Budi", jabatan: "Dokter Hewan Ranap - Poli" },
  { id: "x1", nama: "Kasir", jabatan: null },
];

describe("poliPakaiPemeriksa: hanya Grooming (poli medis sudah punya Dokter)", () => {
  it.each([["Grooming", true], [" grooming ", true], ["GROOMING", true], ["Poli Umum", false], ["Poli Gigi", false], ["Vaksinasi", false], ["", false], [null, false], [undefined, false]])(
    "%j -> %s", (poli, hasil) => expect(poliPakaiPemeriksa(poli as string | null | undefined)).toBe(hasil));
});

describe("pilihanPemeriksa: hanya jabatan dokter, urutan dipertahankan", () => {
  it("menyaring dokter dan membuang groomer, paramedis, asisten dokter, tanpa jabatan", () => {
    expect(pilihanPemeriksa(staf).map((s) => s.id)).toEqual(["d1", "d2"]);
  });
  it("daftar kosong tetap kosong", () => expect(pilihanPemeriksa([])).toEqual([]));
});

describe("bacaPemeriksaId: nilai kiriman form", () => {
  it("poli Grooming + uuid sah -> id (huruf kecil, tanpa spasi)", () => {
    expect(bacaPemeriksaId(`  ${ID.toUpperCase()} `, "Grooming")).toBe(ID);
  });
  it("kosong / bukan teks / bukan uuid -> null", () => {
    for (const v of ["", "   ", null, undefined, "bukan-uuid", "123", new File([], "x")]) expect(bacaPemeriksaId(v as FormDataEntryValue | null, "Grooming")).toBeNull();
  });
  it("poli lain mengabaikan isian (tidak pernah menulis pemeriksa di luar Grooming)", () => {
    expect(bacaPemeriksaId(ID, "Poli Umum")).toBeNull();
    expect(bacaPemeriksaId(ID, "Vaksinasi")).toBeNull();
  });
});

describe("dokterAwalKasir: isian awal slot Dokter di kasir", () => {
  const dasar = { poli: "Grooming", doctorId: "g1", pemeriksaId: "d1", groomingDoctorRequired: true };
  it("Grooming + pemeriksa + cabang mewajibkan dokter -> pemeriksa (bukan groomer)", () => {
    expect(dokterAwalKasir(dasar)).toBe("d1");
  });
  it("cabang TIDAK mewajibkan dokter pada Grooming -> perilaku lama (tidak ada atribusi baru diam-diam)", () => {
    expect(dokterAwalKasir({ ...dasar, groomingDoctorRequired: false })).toBe("g1");
  });
  it("tanpa pemeriksa -> perilaku lama persis", () => {
    expect(dokterAwalKasir({ ...dasar, pemeriksaId: null })).toBe("g1");
    expect(dokterAwalKasir({ ...dasar, pemeriksaId: undefined })).toBe("g1");
  });
  it("poli bukan Grooming mengabaikan pemeriksa -> dokter PJ kunjungan", () => {
    expect(dokterAwalKasir({ ...dasar, poli: "Poli Umum", doctorId: "d2" })).toBe("d2");
  });
  it("tanpa dokter kunjungan -> null bila tak ada pemeriksa", () => {
    expect(dokterAwalKasir({ poli: "Grooming", doctorId: null, pemeriksaId: null, groomingDoctorRequired: true })).toBeNull();
    expect(dokterAwalKasir({ poli: "Poli Umum", doctorId: undefined, pemeriksaId: "d1", groomingDoctorRequired: true })).toBeNull();
  });
  it("kebijakan wajib dokter belum terbaca (null) diperlakukan tidak wajib", () => {
    expect(dokterAwalKasir({ ...dasar, groomingDoctorRequired: null })).toBe("g1");
  });
});

// ── validasi server (karyawan + penugasan cabang) ────────────────────────────────────────────────
type Rows = { employees: unknown[]; assignments: unknown[]; empError?: boolean; asgError?: boolean };
function fakeDb(rows: Rows) {
  const q = (data: unknown, error: boolean) => {
    const o: Record<string, unknown> = {};
    const chain = () => o;
    Object.assign(o, { select: chain, eq: chain, lte: chain, or: chain, is: chain, maybeSingle: async () => ({ data: (data as unknown[])[0] ?? null, error: error ? { message: "x" } : null }),
      then: (r: (v: unknown) => unknown) => Promise.resolve({ data: data, error: error ? { message: "x" } : null }).then(r) });
    return o;
  };
  return { from: (t: string) => t === "employees" ? q(rows.employees, !!rows.empError) : q(rows.assignments, !!rows.asgError) };
}
const dokterRow = (o: Record<string, unknown> = {}) => ({ id: ID, nama: "drh. Aini", jabatan: "Dokter Hewan Poli", status: "Aktif", branch_id: "b1", trashed_at: null, ...o });

describe("periksaPemeriksa", () => {
  it("dokter aktif di cabang utama -> ok + nama dari master", async () => {
    expect(await periksaPemeriksa(fakeDb({ employees: [dokterRow()], assignments: [] }), ID, "b1")).toEqual({ ok: true, nama: "drh. Aini" });
  });
  it("dokter cabang lain dengan penugasan berlaku -> ok", async () => {
    expect((await periksaPemeriksa(fakeDb({ employees: [dokterRow({ branch_id: "b2" })], assignments: [{ employee_id: ID }] }), ID, "b1")).ok).toBe(true);
  });
  it("dokter cabang lain tanpa penugasan -> ditolak dengan pesan cabang", async () => {
    const r = await periksaPemeriksa(fakeDb({ employees: [dokterRow({ branch_id: "b2" })], assignments: [] }), ID, "b1");
    expect(r.ok).toBe(false); expect(r.ok === false && r.pesan).toContain("cabang");
  });
  it.each([["groomer", { jabatan: "Staff Toko - Groomer" }], ["paramedis", { jabatan: "Paramedis" }], ["asisten dokter", { jabatan: "Asisten Dokter Hewan" }], ["tanpa jabatan", { jabatan: null }]])(
    "%s -> ditolak: harus dokter", async (_n, o) => {
      const r = await periksaPemeriksa(fakeDb({ employees: [dokterRow(o)], assignments: [] }), ID, "b1");
      expect(r.ok).toBe(false); expect(r.ok === false && r.pesan).toContain("dokter");
    });
  it("nonaktif / di Sampah / tidak ditemukan -> ditolak", async () => {
    for (const rows of [[dokterRow({ status: "Nonaktif" })], [dokterRow({ trashed_at: "2026-11-01" })], []]) {
      const r = await periksaPemeriksa(fakeDb({ employees: rows, assignments: [] }), ID, "b1");
      expect(r.ok).toBe(false);
    }
  });
  it("gagal baca karyawan atau penugasan -> ditolak (tertutup), bukan lolos", async () => {
    expect((await periksaPemeriksa(fakeDb({ employees: [dokterRow()], assignments: [], empError: true }), ID, "b1")).ok).toBe(false);
    expect((await periksaPemeriksa(fakeDb({ employees: [dokterRow({ branch_id: "b2" })], assignments: [], asgError: true }), ID, "b1")).ok).toBe(false);
  });
});

describe("pemeriksaBerlaku: kode penolakan database -> pesan", () => {
  it("memetakan kode PEMERIKSA_* ke teks Indonesia ringkas; selain itu null", () => {
    expect(pemeriksaBerlaku("PEMERIKSA_BUKAN_DOKTER: dokter pemeriksa harus berjabatan dokter")).toContain("dokter");
    expect(pemeriksaBerlaku("PEMERIKSA_BUKAN_CABANG: x")).toContain("cabang");
    expect(pemeriksaBerlaku("PEMERIKSA_TIDAK_VALID: x")).toContain("aktif");
    expect(pemeriksaBerlaku("PEMERIKSA_TERKUNCI: x")).toContain("tagihan");
    expect(pemeriksaBerlaku("duplicate key")).toBeNull();
    expect(pemeriksaBerlaku(undefined)).toBeNull();
  });
});
