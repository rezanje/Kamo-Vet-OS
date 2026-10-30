// T2: setiap pembaca penugasan harus menghormati tanggal berakhir. Klien palsu di
// bawah benar-benar menerapkan saringan yang dikirim (eq/lte/in/or), jadi tes ini
// gagal bila sebuah pemilih lupa menyaring `end_date`.
import { describe, expect, it } from "vitest";
import { hariIniWIB, geserHari } from "../tanggal";
import { loadServiceStaff } from "../service-performers-server";
import { daftarDokter } from "../dokter";
import { daftarPenjual, penjualValid } from "../penjual";
import { cocokOr } from "./helpers/postgrest-or";

const HARI_INI = hariIniWIB();
const KEMARIN = geserHari(HARI_INI, -1);
const BESOK = geserHari(HARI_INI, 1);
const CABANG = "cabang-bantuan";

type Baris = Record<string, unknown>;

function klienPalsu(tabel: Record<string, Baris[]>) {
  return {
    from(nama: string) {
      let rows = [...(tabel[nama] ?? [])];
      let batas: [number, number] = [0, 9999];
      const q = {
        select: () => q,
        order: () => q,
        eq: (kolom: string, nilai: unknown) => { rows = rows.filter(r => r[kolom] === nilai); return q; },
        lte: (kolom: string, nilai: string) => { rows = rows.filter(r => String(r[kolom]) <= nilai); return q; },
        is: (kolom: string) => { rows = rows.filter(r => r[kolom] == null); return q; },
        in: (kolom: string, daftar: unknown[]) => { rows = rows.filter(r => daftar.includes(r[kolom])); return q; },
        or: (ekspresi: string) => { rows = rows.filter(r => cocokOr(r, ekspresi)); return q; },
        range: (dari: number, sampai: number) => { batas = [dari, sampai]; return q; },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (hasil: unknown) => unknown) =>
          Promise.resolve({ data: rows.slice(batas[0], batas[1] + 1), count: rows.length, error: null }).then(resolve),
      };
      return q;
    },
  };
}

const karyawan = [
  { id: "tetap", nama: "Petugas Tetap", jabatan: "Dokter Hewan", status: "Aktif", branch_id: CABANG },
  { id: "berjalan", nama: "Bantuan Berjalan", jabatan: "Groomer", status: "Aktif", branch_id: "cabang-asal" },
  { id: "berakhir", nama: "Bantuan Berakhir", jabatan: "Groomer", status: "Aktif", branch_id: "cabang-asal" },
  { id: "nanti", nama: "Bantuan Nanti", jabatan: "Groomer", status: "Aktif", branch_id: "cabang-asal" },
];
const penugasan = [
  { id: "berjalan", employee_id: "berjalan", branch_id: CABANG, role: "SECONDARY", effective_date: KEMARIN, end_date: null },
  { id: "berakhir", employee_id: "berakhir", branch_id: CABANG, role: "SECONDARY", effective_date: KEMARIN, end_date: KEMARIN },
  { id: "nanti", employee_id: "nanti", branch_id: CABANG, role: "SECONDARY", effective_date: BESOK, end_date: null },
];
const db = () => klienPalsu({ employees: karyawan, employee_branch_assignments: penugasan });

describe("pemilih petugas berhenti memakai penugasan yang sudah berakhir", () => {
  it("pelaksana jasa klinik & kasir", async () => {
    const hasil = await loadServiceStaff(db(), CABANG);
    expect(hasil.map(row => row.id).sort()).toEqual(["berjalan", "tetap"]);
  });

  it("pemilih dokter/petugas pendaftaran", async () => {
    const hasil = await daftarDokter(db(), { branchId: CABANG });
    expect(hasil.map(row => row.id).sort()).toEqual(["berjalan", "tetap"]);
  });

  it("pemilih penjual SKU", async () => {
    const hasil = await daftarPenjual(db(), CABANG);
    expect(hasil.map(row => row.id).sort()).toEqual(["berjalan", "tetap"]);
  });

  it("pemeriksaan penjual satuan menolak penugasan yang berakhir dan yang belum berlaku", async () => {
    await expect(penjualValid(db(), "berjalan", CABANG)).resolves.toBe(true);
    await expect(penjualValid(db(), "berakhir", CABANG)).resolves.toBe(false);
    await expect(penjualValid(db(), "nanti", CABANG)).resolves.toBe(false);
  });
});
