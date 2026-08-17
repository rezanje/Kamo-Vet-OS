import { describe, expect, it } from "vitest";
import { normalisasiBatch, sisaBelumDijatah, urutFefo } from "../kadaluarsa-batch";

describe("normalisasiBatch", () => {
  it("memecah satu kiriman jadi beberapa tanggal", () => {
    expect(normalisasiBatch(10, [
      { qty: 4, exp_date: "2027-01-31" },
      { qty: 6, exp_date: "2026-11-30" },
    ])).toEqual([
      { qty: 6, expDate: "2026-11-30" },
      { qty: 4, expDate: "2027-01-31" },
    ]);
  });

  it("sisa yang tidak dijatah tetap masuk stok, tanpa tanggal", () => {
    expect(normalisasiBatch(10, [{ qty: 3, exp_date: "2026-12-01" }])).toEqual([
      { qty: 3, expDate: "2026-12-01" },
      { qty: 7, expDate: null },
    ]);
  });

  it("isian melebihi qty diterima dipotong — stok tidak boleh membengkak", () => {
    const hasil = normalisasiBatch(5, [
      { qty: 4, exp_date: "2026-10-10" },
      { qty: 9, exp_date: "2026-12-12" },
    ]);
    expect(hasil.reduce((a, b) => a + b.qty, 0)).toBe(5);
    expect(hasil).toEqual([
      { qty: 4, expDate: "2026-10-10" },
      { qty: 1, expDate: "2026-12-12" },
    ]);
  });

  it("tanggal sama digabung jadi satu lapisan", () => {
    expect(normalisasiBatch(8, [
      { qty: 3, exp_date: "2026-09-09" },
      { qty: 5, exp_date: "2026-09-09" },
    ])).toEqual([{ qty: 8, expDate: "2026-09-09" }]);
  });

  it("tanggal ngawur diabaikan, qty-nya jatuh ke lapisan tanpa tanggal", () => {
    expect(normalisasiBatch(4, [{ qty: 4, exp_date: "besok" }])).toEqual([{ qty: 4, expDate: null }]);
  });

  it("tanpa penerimaan = tanpa lapisan", () => {
    expect(normalisasiBatch(0, [{ qty: 3, exp_date: "2026-09-09" }])).toEqual([]);
  });
});

describe("sisaBelumDijatah", () => {
  it("menghitung sisa yang belum diberi tanggal", () => {
    expect(sisaBelumDijatah(10, [{ qty: 4, exp_date: "2026-11-30" }])).toBe(6);
    expect(sisaBelumDijatah(10, [{ qty: 44, exp_date: "2026-11-30" }])).toBe(0);
    expect(sisaBelumDijatah(10, [{ qty: 4, exp_date: "" }])).toBe(10);
  });
});

describe("urutFefo", () => {
  it("yang paling dekat kadaluarsa keluar duluan", () => {
    const urut = urutFefo([
      { exp_date: "2027-01-01", tanggal: "2026-01-01" },
      { exp_date: "2026-09-01", tanggal: "2026-08-01" },
    ]);
    expect(urut.map((l) => l.exp_date)).toEqual(["2026-09-01", "2027-01-01"]);
  });

  it("lapisan tanpa tanggal kadaluarsa dipakai belakangan", () => {
    const urut = urutFefo([
      { exp_date: null, tanggal: "2025-01-01" },
      { exp_date: "2030-01-01", tanggal: "2026-08-01" },
    ]);
    expect(urut.map((l) => l.exp_date)).toEqual(["2030-01-01", null]);
  });

  it("tanggal kadaluarsa sama → yang lebih dulu masuk keluar duluan", () => {
    const urut = urutFefo([
      { exp_date: "2026-12-01", tanggal: "2026-08-10", created_at: "b" },
      { exp_date: "2026-12-01", tanggal: "2026-08-01", created_at: "a" },
    ]);
    expect(urut.map((l) => l.tanggal)).toEqual(["2026-08-01", "2026-08-10"]);
  });

  it("semua tanpa tanggal = FIFO biasa", () => {
    const urut = urutFefo([
      { exp_date: null, tanggal: "2026-08-05" },
      { exp_date: null, tanggal: "2026-08-01" },
    ]);
    expect(urut.map((l) => l.tanggal)).toEqual(["2026-08-01", "2026-08-05"]);
  });
});
