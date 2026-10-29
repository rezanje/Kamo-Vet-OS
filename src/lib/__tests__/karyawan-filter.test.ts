import { describe, expect, it } from "vitest";
import { cocokGrupJabatan, normalisasiCari, saringKaryawan } from "../karyawan-filter";

const daftar = [
  { id: "e1", nama: "Ré Nawangsari", nik: "K-001", jabatan: "Dokter Hewan Poli", departemen: "Medis", phone: "0811-1111", email: "re@klinik.id", status: "Aktif", branch_id: "b1", branchName: "Kamo Cimanggu", assignments: [{ branch_id: "b2", branchName: "Kamo Bogor" }] },
  { id: "e2", nama: "Budi Santoso", nik: "K-002", jabatan: "Staff Toko - Groomer", departemen: "Operasional", phone: null, email: null, status: "Aktif", branch_id: "b2", branchName: "Kamo Bogor", assignments: [] },
  { id: "e3", nama: "Citra Dewi", nik: null, jabatan: "Paramedis", departemen: null, phone: null, email: "citra@klinik.id", status: "Nonaktif", branch_id: null, branchName: "—", assignments: [] },
  { id: "e4", nama: "Dani Pratama", nik: "K-004", jabatan: "Kepala Toko", departemen: "Operasional", phone: "0822-2222", email: null, status: "Aktif", branch_id: "b1", branchName: "Kamo Cimanggu", assignments: [] },
];
const nama = (rows: typeof daftar) => rows.map((row) => row.id);

describe("normalisasiCari", () => {
  it("mengabaikan huruf besar, diakritik, dan spasi berlebih", () => {
    expect(normalisasiCari("  Ré   NAWANGsari ")).toBe("re nawangsari");
  });
});

describe("saringKaryawan", () => {
  it("tanpa saringan mengembalikan seluruh baris", () => {
    expect(nama(saringKaryawan(daftar, {}))).toEqual(["e1", "e2", "e3", "e4"]);
  });

  it("mencocokkan potongan nama di tengah kata tanpa peduli diakritik", () => {
    expect(nama(saringKaryawan(daftar, { cari: "nawang" }))).toEqual(["e1"]);
    expect(nama(saringKaryawan(daftar, { cari: "RE NAWANGSARI" }))).toEqual(["e1"]);
  });

  it("mencari lewat NIK, jabatan, departemen, no HP, dan email", () => {
    expect(nama(saringKaryawan(daftar, { cari: "K-004" }))).toEqual(["e4"]);
    expect(nama(saringKaryawan(daftar, { cari: "groomer" }))).toEqual(["e2"]);
    expect(nama(saringKaryawan(daftar, { cari: "operasional" }))).toEqual(["e2", "e4"]);
    expect(nama(saringKaryawan(daftar, { cari: "0822" }))).toEqual(["e4"]);
    expect(nama(saringKaryawan(daftar, { cari: "citra@klinik.id" }))).toEqual(["e3"]);
  });

  it("mencari lewat nama cabang utama maupun cabang penugasan", () => {
    expect(nama(saringKaryawan(daftar, { cari: "cimanggu" }))).toEqual(["e1", "e4"]);
    expect(nama(saringKaryawan(daftar, { cari: "bogor" }))).toEqual(["e1", "e2"]);
  });

  it("menyaring per cabang memakai cabang utama atau penugasan lintas cabang", () => {
    expect(nama(saringKaryawan(daftar, { cabang: "b2" }))).toEqual(["e1", "e2"]);
    expect(nama(saringKaryawan(daftar, { cabang: "b1" }))).toEqual(["e1", "e4"]);
  });

  it("menyaring per grup jabatan klinis dan menyisakan sisanya di Lainnya", () => {
    expect(nama(saringKaryawan(daftar, { grup: "dokter" }))).toEqual(["e1"]);
    expect(nama(saringKaryawan(daftar, { grup: "paramedis" }))).toEqual(["e3"]);
    expect(nama(saringKaryawan(daftar, { grup: "groomer" }))).toEqual(["e2"]);
    expect(nama(saringKaryawan(daftar, { grup: "lainnya" }))).toEqual(["e4"]);
  });

  it("menggabungkan kata pencarian dengan saringan cabang dan jabatan", () => {
    expect(nama(saringKaryawan(daftar, { cari: "a", cabang: "b1", grup: "lainnya" }))).toEqual(["e4"]);
    expect(nama(saringKaryawan(daftar, { cari: "budi", cabang: "b1" }))).toEqual([]);
  });

  it("mengabaikan nilai grup yang tidak dikenal daripada mengosongkan daftar", () => {
    expect(nama(saringKaryawan(daftar, { grup: "entah" }))).toEqual(["e1", "e2", "e3", "e4"]);
  });
});

describe("cocokGrupJabatan", () => {
  it("memakai aturan jabatan klinis yang sama dengan pemilih petugas klinik", () => {
    expect(cocokGrupJabatan("Asisten Dokter", "paramedis")).toBe(true);
    expect(cocokGrupJabatan("Asisten Dokter", "dokter")).toBe(false);
    expect(cocokGrupJabatan(null, "lainnya")).toBe(true);
  });
});
