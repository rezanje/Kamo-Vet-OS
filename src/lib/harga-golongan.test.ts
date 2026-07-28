import { describe, it, expect } from "vitest";
import { diskonGolongan } from "./harga-golongan";

describe("diskonGolongan", () => {
  it("persen normal dihitung dari subtotal", () => {
    expect(diskonGolongan(100000, 10)).toBe(10000);
    expect(diskonGolongan(150000, 2.5)).toBe(3750);
  });

  it("nol persen atau tanpa golongan = tidak ada diskon", () => {
    expect(diskonGolongan(100000, 0)).toBe(0);
  });

  it("seratus persen mentok di subtotal, tidak lebih", () => {
    expect(diskonGolongan(100000, 100)).toBe(100000);
  });

  it("pecahan rupiah dibulatkan, tidak menghasilkan sen", () => {
    expect(diskonGolongan(1005, 10)).toBe(101);
    expect(Number.isInteger(diskonGolongan(333, 33.33))).toBe(true);
  });

  it("subtotal nol atau negatif tidak pernah jadi diskon negatif", () => {
    expect(diskonGolongan(0, 25)).toBe(0);
    expect(diskonGolongan(-5000, 25)).toBe(0);
  });

  it("persen kotor dari data tetap ter-cap di [0, subtotal]", () => {
    expect(diskonGolongan(100000, -10)).toBe(0);
    expect(diskonGolongan(100000, 400)).toBe(100000);
    expect(diskonGolongan(100000, Number.NaN)).toBe(0);
  });
});
