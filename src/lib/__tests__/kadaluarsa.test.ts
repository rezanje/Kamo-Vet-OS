import { describe, it, expect } from "vitest";
import { statusExp, selisihHari, susunMonitor, ringkasMonitor, type LapisanStok } from "../kadaluarsa";

describe("selisihHari", () => {
  it("menghitung lintas bulan & tahun", () => {
    expect(selisihHari("2026-08-06", "2026-09-05")).toBe(30);
    expect(selisihHari("2026-12-31", "2027-01-01")).toBe(1);
    expect(selisihHari("2026-08-06", "2026-08-01")).toBe(-5);
  });
});

describe("statusExp", () => {
  const hariIni = "2026-08-06";
  it("kemarin = lewat, hari ini masih kritis (bukan lewat)", () => {
    expect(statusExp("2026-08-05", hariIni)).toBe("lewat");
    expect(statusExp("2026-08-06", hariIni)).toBe("kritis");
  });
  it("batas 30 & 90 hari inklusif", () => {
    expect(statusExp("2026-09-05", hariIni)).toBe("kritis");   // tepat 30
    expect(statusExp("2026-09-06", hariIni)).toBe("waspada");  // 31
    expect(statusExp("2026-11-04", hariIni)).toBe("waspada");  // tepat 90
    expect(statusExp("2026-11-05", hariIni)).toBe("aman");     // 91
  });
});

describe("susunMonitor & ringkasMonitor", () => {
  const layers: LapisanStok[] = [
    { itemId: "a", namaBarang: "Vaksin A", gudang: "G1", qty: 2, satuan: "vial", expDate: "2026-12-01", nilai: 200_000 },
    { itemId: "b", namaBarang: "Obat B", gudang: "G1", qty: 5, satuan: "botol", expDate: "2026-08-01", nilai: 50_000 },
    { itemId: "c", namaBarang: "Obat C", gudang: "G2", qty: 1, satuan: "box", expDate: "2026-08-20", nilai: 75_000 },
  ];

  it("yang paling mendesak di atas, termasuk yang sudah lewat", () => {
    const b = susunMonitor(layers, "2026-08-06");
    expect(b.map((x) => x.namaBarang)).toEqual(["Obat B", "Obat C", "Vaksin A"]);
    expect(b[0].status).toBe("lewat");
    expect(b[0].sisaHari).toBe(-5);
  });

  it("ringkasan menjumlahkan nilai yang terancam hangus", () => {
    const r = ringkasMonitor(susunMonitor(layers, "2026-08-06"));
    expect(r.lewat).toBe(1);
    expect(r.kritis).toBe(1);
    expect(r.waspada).toBe(0);
    expect(r.nilaiTerancam).toBe(125_000);
  });
});
