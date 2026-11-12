import { describe, expect, it } from "vitest";
import { atribusiVisit, rekapVisit, saringVisit, totalCatatan, type BarisVisit } from "../laporan-visit";

// Fixture fiktif: nama orang di sini tidak merujuk data nyata.
function baris(over: Partial<BarisVisit> & { id: string }): BarisVisit {
  return {
    tanggal: "2026-11-10", waktu: "2026-11-10T03:00:00Z", jenis: "doctor_visit", inpatientId: "ranap-1",
    cabangId: "cabang", cabang: "Cabang Uji", pasien: "Milo", pemilik: "Pemilik Fiktif", kondisi: "", tindakan: "",
    dokterId: "dokter", dokterNama: "Drh. Fiktif", paramedisId: "perawat", paramedisNama: "Perawat Fiktif", ...over,
  };
}

describe("A4: laporan visit rawat inap", () => {
  it("satu catatan visit dokter = 1 visit untuk dokter dan 1 untuk paramedisnya", () => {
    const rekap = rekapVisit(atribusiVisit([baris({ id: "a" })]));
    expect(rekap.map((r) => [r.nama, r.peran, r.visit])).toEqual([
      ["Drh. Fiktif", "Dokter", 1],
      ["Perawat Fiktif", "Paramedis", 1],
    ]);
  });

  it("menghitung pasien dan hari berbeda; pemantauan tidak menambah visit", () => {
    const rows = [
      baris({ id: "a", inpatientId: "r1", tanggal: "2026-11-10" }),
      baris({ id: "b", inpatientId: "r1", tanggal: "2026-11-10" }),
      baris({ id: "c", inpatientId: "r2", tanggal: "2026-11-11" }),
      baris({ id: "d", jenis: "monitoring", inpatientId: "r3", tanggal: "2026-11-12" }),
    ];
    const [dokter] = rekapVisit(saringVisit(atribusiVisit(rows), { peran: "Dokter" }));
    expect([dokter.visit, dokter.pasien, dokter.hari, dokter.pemantauan]).toEqual([3, 2, 2, 1]);
    expect(totalCatatan(rows)).toEqual({ visit: 3, pemantauan: 1, pasien: 2 });
  });

  it("catatan tanpa paramedis hanya dihitung untuk dokter", () => {
    const rekap = rekapVisit(atribusiVisit([baris({ id: "a", paramedisId: null, paramedisNama: null })]));
    expect(rekap.map((r) => r.peran)).toEqual(["Dokter"]);
  });

  it("menyaring per orang dan cabang; data lama tanpa ID dikelompokkan menurut nama", () => {
    const rows = [
      baris({ id: "a" }),
      baris({ id: "b", dokterId: "dokter-2", dokterNama: "Drh. Lain", cabangId: "cabang-2" }),
      baris({ id: "c", dokterId: null, dokterNama: "drh. lama ", paramedisId: null, paramedisNama: null }),
      baris({ id: "d", dokterId: null, dokterNama: "Drh. Lama", paramedisId: null, paramedisNama: null }),
    ];
    const semua = atribusiVisit(rows);
    expect(rekapVisit(saringVisit(semua, { employeeId: "dokter" })).map((r) => [r.nama, r.visit])).toEqual([["Drh. Fiktif", 1]]);
    expect(saringVisit(semua, { cabangId: "cabang-2" }).map((a) => a.baris.id)).toEqual(["b", "b"]);
    const lama = rekapVisit(semua).find((r) => r.employeeId === null);
    expect(lama?.visit).toBe(2);
  });
});
