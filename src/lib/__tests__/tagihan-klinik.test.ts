// Pembagian potongan voucher rombongan — kesepakatan 2026-08-12: satu voucher
// per kedatangan, potongannya dibagi proporsional ke nota tiap hewan.

import { describe, it, expect } from "vitest";
import { bagiPotongan } from "../tagihan-klinik";

describe("bagiPotongan", () => {
  it("membagi sesuai porsi tagihan tiap hewan", () => {
    expect(bagiPotongan([500_000, 300_000, 200_000], 100_000)).toEqual([50_000, 30_000, 20_000]);
  });

  it("jumlah bagian selalu persis sama dengan nilai voucher (sisa pembulatan ke nota terbesar)", () => {
    const bagian = bagiPotongan([100, 100, 100], 10);
    expect(bagian.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it("tidak memotong lebih besar dari total tagihan", () => {
    expect(bagiPotongan([50_000, 50_000], 500_000)).toEqual([50_000, 50_000]);
  });

  it("tagihan nol tidak kebagian potongan", () => {
    expect(bagiPotongan([0, 200_000], 50_000)).toEqual([0, 50_000]);
  });

  it("tanpa voucher tidak ada yang dipotong", () => {
    expect(bagiPotongan([100_000, 100_000], 0)).toEqual([0, 0]);
  });
});
