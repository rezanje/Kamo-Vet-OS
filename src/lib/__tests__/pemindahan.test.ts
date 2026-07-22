import { describe, expect, it } from "vitest";
import { formatNoPemindahan, hitungStatusKirim, sisaTransit } from "../pemindahan";

describe("formatNoPemindahan", () => {
  it("format IT.YYYY.MM.NNNNN", () => {
    expect(formatNoPemindahan(new Date(2026, 6, 22), 542)).toBe("IT.2026.07.00542");
    expect(formatNoPemindahan(new Date(2026, 11, 1), 1)).toBe("IT.2026.12.00001");
  });
});

describe("hitungStatusKirim", () => {
  it("belum ada penerimaan -> Sedang dikirim", () => {
    expect(hitungStatusKirim(100, 0)).toBe("Sedang dikirim");
  });
  it("sebagian diterima -> Diterima Sebagian", () => {
    expect(hitungStatusKirim(100, 40)).toBe("Diterima Sebagian");
  });
  it("semua diterima -> Diterima Seluruhnya", () => {
    expect(hitungStatusKirim(100, 100)).toBe("Diterima Seluruhnya");
    expect(hitungStatusKirim(100, 120)).toBe("Diterima Seluruhnya");
  });
});

describe("sisaTransit", () => {
  it("hitung sisa per item, item habis tidak muncul", () => {
    expect(
      sisaTransit({ a: 10, b: 5 }, { a: 4, b: 5 }),
    ).toEqual({ a: 6 });
  });
  it("tanpa penerimaan -> semua sisa", () => {
    expect(sisaTransit({ a: 3 }, {})).toEqual({ a: 3 });
  });
});
