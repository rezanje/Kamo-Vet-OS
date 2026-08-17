import { describe, expect, it } from "vitest";
import { hargaTingkat, rapikanTingkat, tingkatBerikutnya } from "../harga-tingkat";

const tiers = [
  { min_qty: 12, harga: 32_000 },
  { min_qty: 3, harga: 34_000 },
  { min_qty: 50, harga: 30_000 },
];

describe("hargaTingkat", () => {
  it("di bawah semua tingkat = harga normal", () => {
    expect(hargaTingkat(2, tiers, 35_000)).toBe(35_000);
  });

  it("memakai tingkat tertinggi yang sudah tercapai", () => {
    expect(hargaTingkat(3, tiers, 35_000)).toBe(34_000);
    expect(hargaTingkat(11, tiers, 35_000)).toBe(34_000);
    expect(hargaTingkat(12, tiers, 35_000)).toBe(32_000);
    expect(hargaTingkat(1000, tiers, 35_000)).toBe(30_000);
  });

  it("tanpa tingkat = harga normal", () => {
    expect(hargaTingkat(99, [], 35_000)).toBe(35_000);
  });

  it("angka ngawur tidak bikin harga jadi NaN", () => {
    expect(hargaTingkat(Number.NaN, tiers, 35_000)).toBe(35_000);
    expect(hargaTingkat(5, [{ min_qty: 0, harga: 1 }], 35_000)).toBe(35_000);
  });
});

describe("rapikanTingkat", () => {
  it("urut naik dan membuang baris tanpa jumlah", () => {
    expect(rapikanTingkat([{ min_qty: 12, harga: 1 }, { min_qty: 0, harga: 9 }, { min_qty: 3, harga: 2 }]))
      .toEqual([{ min_qty: 3, harga: 2 }, { min_qty: 12, harga: 1 }]);
  });
});

describe("tingkatBerikutnya", () => {
  it("menunjukkan tingkat yang belum tercapai", () => {
    expect(tingkatBerikutnya(2, tiers)).toEqual({ min_qty: 3, harga: 34_000 });
    expect(tingkatBerikutnya(12, tiers)).toEqual({ min_qty: 50, harga: 30_000 });
    expect(tingkatBerikutnya(999, tiers)).toBeNull();
  });
});
