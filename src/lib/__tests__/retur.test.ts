import { describe, expect, it } from "vitest";
import { formatNoRetur, sisaRetur, totalRetur } from "../retur";

describe("formatNoRetur", () => {
  it("format RB/RJ.YYYY.MM.NNNNN", () => {
    expect(formatNoRetur("RB", new Date(2026, 6, 23), 1)).toBe("RB.2026.07.00001");
    expect(formatNoRetur("RJ", new Date(2026, 11, 3), 42)).toBe("RJ.2026.12.00042");
  });
});

describe("sisaRetur", () => {
  it("kurangi retur sebelumnya, item habis hilang", () => {
    expect(sisaRetur({ a: 10, b: 2 }, { a: 4, b: 2 })).toEqual({ a: 6 });
  });
  it("tanpa retur sebelumnya", () => {
    expect(sisaRetur({ a: 3 }, {})).toEqual({ a: 3 });
  });
});

describe("totalRetur", () => {
  it("jumlahkan qty x harga", () => {
    expect(totalRetur([{ qty: 2, harga: 5000 }, { qty: 1, harga: 2500 }])).toBe(12500);
  });
  it("baris kosong = 0", () => {
    expect(totalRetur([])).toBe(0);
  });
});
