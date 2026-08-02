import { describe, expect, it } from "vitest";
import { cicilanPeriode, jadwalCicilan, sisaKasbon } from "../kasbon";

describe("jadwalCicilan", () => {
  it("membagi rata kalau habis dibagi", () => {
    expect(jadwalCicilan(3_000_000, 3)).toEqual([1_000_000, 1_000_000, 1_000_000]);
  });

  it("sisa pembulatan masuk ke cicilan terakhir, total tetap pas", () => {
    const c = jadwalCicilan(1_000_000, 3);
    expect(c).toEqual([333_333, 333_333, 333_334]);
    expect(c.reduce((a, b) => a + b, 0)).toBe(1_000_000);
  });

  it("tenor 1 = potong sekaligus", () => {
    expect(jadwalCicilan(750_000, 1)).toEqual([750_000]);
  });
});

describe("cicilanPeriode", () => {
  it("potongan bulan berjalan", () => {
    expect(cicilanPeriode(3_000_000, 3, 0)).toBe(1_000_000);
    expect(cicilanPeriode(3_000_000, 3, 1_000_000)).toBe(1_000_000);
  });

  it("cicilan terakhir menutup sisa, tidak melebihi utang", () => {
    expect(cicilanPeriode(1_000_000, 3, 666_666)).toBe(333_334);
  });

  it("sudah lunas = tidak ada potongan lagi", () => {
    expect(cicilanPeriode(1_000_000, 3, 1_000_000)).toBe(0);
    expect(cicilanPeriode(1_000_000, 3, 1_500_000)).toBe(0);
  });
});

describe("sisaKasbon", () => {
  it("tidak pernah negatif", () => {
    expect(sisaKasbon(500_000, 800_000)).toBe(0);
    expect(sisaKasbon(500_000, 200_000)).toBe(300_000);
  });
});
