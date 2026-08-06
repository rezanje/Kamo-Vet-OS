import { describe, it, expect } from "vitest";
import { isTenagaMedis, rentangTujuhHari, jumlahJaga, type BarisJadwal } from "../jadwal-dokter";

describe("isTenagaMedis", () => {
  it("mengenali dokter & paramedis, menolak kasir", () => {
    expect(isTenagaMedis({ nama: "Rena", jabatan: "Dokter Hewan" })).toBe(true);
    expect(isTenagaMedis({ nama: "Drh. Budi", jabatan: null })).toBe(true);
    expect(isTenagaMedis({ nama: "Siti", jabatan: "Paramedis" })).toBe(true);
    expect(isTenagaMedis({ nama: "Ani", jabatan: "Kasir" })).toBe(false);
  });
});

describe("rentangTujuhHari", () => {
  it("tujuh hari berurutan termasuk lompat bulan", () => {
    const r = rentangTujuhHari("2026-08-30");
    expect(r).toHaveLength(7);
    expect(r[0].tanggal).toBe("2026-08-30");
    expect(r[2].tanggal).toBe("2026-09-01");
    expect(r[6].tanggal).toBe("2026-09-05");
  });
});

describe("jumlahJaga", () => {
  const baris: BarisJadwal[] = [
    { employeeId: "a", nama: "A", jabatan: "Dokter Hewan", perHari: { "2026-08-06": { nama: "Pagi", jam: "08:00–16:00", libur: false } } },
    { employeeId: "b", nama: "B", jabatan: "Dokter Hewan", perHari: { "2026-08-06": { nama: "Libur", jam: "Libur", libur: true } } },
    { employeeId: "c", nama: "C", jabatan: "Paramedis", perHari: { "2026-08-06": null } },
  ];

  it("hanya menghitung yang benar-benar masuk", () => {
    expect(jumlahJaga(baris, "2026-08-06")).toBe(1);
  });

  it("tanggal tanpa jadwal sama sekali = 0", () => {
    expect(jumlahJaga(baris, "2026-08-07")).toBe(0);
  });
});
