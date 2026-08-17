import { describe, expect, it } from "vitest";
import { poinTerpakai, RUPIAH_PER_POIN } from "../poin-klinik";

describe("poinTerpakai", () => {
  it("tidak melebihi saldo pelanggan", () => {
    expect(poinTerpakai(5000, 1200, 999_999)).toBe(1200);
  });

  it("tidak melebihi tagihan — poin sisa tidak ikut hangus", () => {
    expect(poinTerpakai(5000, 5000, 3000 * RUPIAH_PER_POIN)).toBe(3000);
  });

  it("angka aneh dianggap nol", () => {
    expect(poinTerpakai(-10, 500, 500)).toBe(0);
    expect(poinTerpakai(Number.NaN, 500, 500)).toBe(0);
    expect(poinTerpakai(100, 500, 0)).toBe(0);
  });

  it("selalu bulat", () => {
    expect(Number.isInteger(poinTerpakai(10.9, 100, 100))).toBe(true);
  });
});
