import { describe, it, expect } from "vitest";
import { periodeSelesai, tanggalTerakhir, bolehKunci, ringkasHasil, selisihHari } from "../akhir-bulan";

describe("periodeSelesai", () => {
  it("bulan sebelum hari ini", () => {
    expect(periodeSelesai("2026-08-25")).toBe("2026-07");
  });
  it("menyeberang tahun", () => {
    expect(periodeSelesai("2026-01-01")).toBe("2025-12");
  });
});

describe("tanggalTerakhir", () => {
  it("bulan 31 hari, 30 hari, dan Februari", () => {
    expect(tanggalTerakhir("2026-01")).toBe("2026-01-31");
    expect(tanggalTerakhir("2026-04")).toBe("2026-04-30");
    expect(tanggalTerakhir("2026-02")).toBe("2026-02-28");
  });
  it("Februari tahun kabisat", () => {
    expect(tanggalTerakhir("2028-02")).toBe("2028-02-29");
  });
});

describe("bolehKunci", () => {
  const dasar = { periode: "2026-07", jedaHari: 5, terkunciSampai: null as string | null };

  it("belum lewat masa tenggang = belum boleh", () => {
    expect(bolehKunci({ ...dasar, hariIni: "2026-08-03" })).toBe(false);
  });

  it("tepat di ujung masa tenggang sudah boleh", () => {
    expect(bolehKunci({ ...dasar, hariIni: "2026-08-05" })).toBe(true);
  });

  it("periode yang sudah terkunci tidak dikunci ulang", () => {
    expect(bolehKunci({ ...dasar, hariIni: "2026-08-20", terkunciSampai: "2026-07-31" })).toBe(false);
  });

  it("kunci lama yang lebih pendek tetap boleh dimajukan", () => {
    expect(bolehKunci({ ...dasar, hariIni: "2026-08-20", terkunciSampai: "2026-06-30" })).toBe(true);
  });

  it("tanpa masa tenggang boleh sejak hari terakhir bulan itu", () => {
    expect(bolehKunci({ ...dasar, jedaHari: 0, hariIni: "2026-07-31" })).toBe(true);
  });
});

describe("selisihHari", () => {
  it("menghitung lintas bulan", () => {
    expect(selisihHari("2026-07-31", "2026-08-05")).toBe(5);
  });
});

describe("ringkasHasil", () => {
  it("menyebut apa yang dikerjakan", () => {
    expect(ringkasHasil({
      periode: "2026-07",
      penyusutan: [{ periode: "2026-07", total: 100, jumlahAset: 2 }],
      jurnalBerulang: [{ nama: "Sewa", periode: "2026-07" }],
      dikunciSampai: "2026-07-31",
      kunciDilewati: null,
    })).toBe("1 periode penyusutan · 1 jurnal berulang · terkunci s/d 2026-07-31");
  });

  it("menyebut alasan kalau penguncian dilewati", () => {
    expect(ringkasHasil({
      periode: "2026-07", penyusutan: [], jurnalBerulang: [],
      dikunciSampai: null, kunciDilewati: "masa tenggang belum lewat",
    })).toMatch(/masa tenggang belum lewat/);
  });
});
