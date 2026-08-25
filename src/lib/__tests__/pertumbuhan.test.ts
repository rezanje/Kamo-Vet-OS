import { describe, it, expect } from "vitest";
import { pertumbuhanBulanan, rentangBulan, labelBulan, rekapPoin } from "../pertumbuhan";

describe("rentangBulan", () => {
  it("menyeberang tahun", () => {
    expect(rentangBulan("2025-11-05", "2026-02-20")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  it("satu bulan saja", () => {
    expect(rentangBulan("2026-08-01", "2026-08-31")).toEqual(["2026-08"]);
  });
  it("rentang terbalik menghasilkan kosong, bukan gantung", () => {
    expect(rentangBulan("2026-08-01", "2026-07-01")).toEqual([]);
  });
});

describe("pertumbuhanBulanan", () => {
  const gabung = [
    "2026-06-10", "2026-07-02", "2026-07-20", "2026-08-01", "2026-08-05", "2026-08-06",
  ];

  it("member baru dihitung per bulan", () => {
    const r = pertumbuhanBulanan(gabung, "2026-07-01", "2026-08-31");
    expect(r.map((x) => x.baru)).toEqual([2, 3]);
  });

  it("kumulatif ikut menghitung member sebelum rentang", () => {
    const r = pertumbuhanBulanan(gabung, "2026-07-01", "2026-08-31");
    expect(r.map((x) => x.kumulatif)).toEqual([3, 6]);
  });

  it("bulan tanpa member baru tetap muncul sebagai nol", () => {
    const r = pertumbuhanBulanan(["2026-06-10"], "2026-06-01", "2026-08-31");
    expect(r.map((x) => x.baru)).toEqual([1, 0, 0]);
    expect(r.at(-1)!.kumulatif).toBe(1);
  });

  it("menerima waktu ISO lengkap, bukan cuma tanggal", () => {
    const r = pertumbuhanBulanan(["2026-08-01T10:00:00Z"], "2026-08-01", "2026-08-31");
    expect(r[0].baru).toBe(1);
  });
});

describe("labelBulan", () => {
  it("dibaca manusia", () => {
    expect(labelBulan("2026-08")).toBe("Agu 2026");
  });
});

describe("rekapPoin", () => {
  it("memisahkan poin didapat dan poin dipakai", () => {
    expect(rekapPoin([100, -30, 50, -20])).toEqual({ terkumpul: 150, ditukar: 50, net: 100 });
  });
  it("tanpa mutasi tetap nol", () => {
    expect(rekapPoin([])).toEqual({ terkumpul: 0, ditukar: 0, net: 0 });
  });
});
