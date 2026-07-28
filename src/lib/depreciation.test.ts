import { describe, it, expect } from "vitest";
import { groupDepreciationLines } from "./depreciation";

const seimbang = (lines: { debit: number; credit: number }[]) =>
  lines.reduce((a, l) => a + l.debit, 0) === lines.reduce((a, l) => a + l.credit, 0);

describe("groupDepreciationLines", () => {
  it("dua kategori dgn akun berbeda jadi dua pasang baris yang tetap seimbang", () => {
    const lines = groupDepreciationLines([
      { amount: 100000, akunBeban: "5601", akunAkumulasi: "1509" },
      { amount: 250000, akunBeban: "5602", akunAkumulasi: "1510" },
    ]);
    expect(lines).toEqual([
      { code: "5601", debit: 100000, credit: 0 },
      { code: "1509", debit: 0, credit: 100000 },
      { code: "5602", debit: 250000, credit: 0 },
      { code: "1510", debit: 0, credit: 250000 },
    ]);
    expect(seimbang(lines)).toBe(true);
  });

  it("aset tanpa kategori jatuh ke akun default 5601/1509", () => {
    const lines = groupDepreciationLines([{ amount: 50000, akunBeban: null, akunAkumulasi: null }]);
    expect(lines).toEqual([
      { code: "5601", debit: 50000, credit: 0 },
      { code: "1509", debit: 0, credit: 50000 },
    ]);
  });

  it("aset sekategori digabung jadi satu pasang baris, bukan satu pasang per aset", () => {
    const lines = groupDepreciationLines([
      { amount: 10000, akunBeban: "5601", akunAkumulasi: "1509" },
      { amount: 15000, akunBeban: "5601", akunAkumulasi: "1509" },
    ]);
    expect(lines).toEqual([
      { code: "5601", debit: 25000, credit: 0 },
      { code: "1509", debit: 0, credit: 25000 },
    ]);
  });

  it("jumlah nol dilewati supaya tidak ada baris jurnal kosong", () => {
    expect(groupDepreciationLines([{ amount: 0, akunBeban: "5601", akunAkumulasi: "1509" }])).toEqual([]);
    expect(groupDepreciationLines([])).toEqual([]);
  });
});
