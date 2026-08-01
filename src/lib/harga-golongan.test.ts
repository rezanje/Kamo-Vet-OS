import { describe, it, expect } from "vitest";
import { diskonGolongan, poinDidapat, RUPIAH_PER_POIN_DEFAULT } from "./harga-golongan";

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

describe("poinDidapat", () => {
  it("golongan tanpa pengaturan sendiri = perilaku lama Rp1.000/poin", () => {
    expect(RUPIAH_PER_POIN_DEFAULT).toBe(1000);
    expect(poinDidapat(250_000, null)).toBe(250);
    expect(poinDidapat(250_000, undefined)).toBe(250);
  });

  it("golongan lebih royal dapat poin lebih banyak", () => {
    expect(poinDidapat(250_000, 500)).toBe(500);
    expect(poinDidapat(250_000, 2000)).toBe(125);
  });

  it("belanja belum genap tidak dihitung sebagian", () => {
    expect(poinDidapat(1_999, 1000)).toBe(1);
    expect(poinDidapat(999, 1000)).toBe(0);
  });

  it("nilai kotor tidak bikin poin ngawur", () => {
    expect(poinDidapat(0, 1000)).toBe(0);
    expect(poinDidapat(-5000, 1000)).toBe(0);
    expect(poinDidapat(100_000, 0)).toBe(100);      // rate 0 → jatuh ke default
    expect(poinDidapat(100_000, Number.NaN)).toBe(100);
  });
});
