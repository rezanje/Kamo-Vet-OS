import { describe, expect, it } from "vitest";
import { buildFakturLines, formatNoFaktur, sisaFakturable } from "../faktur-beli";

describe("formatNoFaktur", () => {
  it("format FB.YYYY.MM.NNNNN", () => {
    expect(formatNoFaktur(new Date(2026, 6, 24), 1)).toBe("FB.2026.07.00001");
  });
});

describe("buildFakturLines", () => {
  const sum = (ls: { debit: number; credit: number }[]) => ({
    d: ls.reduce((a, l) => a + l.debit, 0),
    k: ls.reduce((a, l) => a + l.credit, 0),
  });

  it("faktur = PO: 2102 lawan 2101, tanpa selisih", () => {
    const lines = buildFakturLines(100, 100);
    expect(lines).toEqual([
      { code: "2102", debit: 100, credit: 0 },
      { code: "2101", debit: 0, credit: 100 },
    ]);
  });

  it("faktur lebih mahal: selisih Dr 1301, seimbang", () => {
    const lines = buildFakturLines(100, 120);
    expect(lines).toContainEqual({ code: "1301", debit: 20, credit: 0 });
    const { d, k } = sum(lines);
    expect(d).toBe(k);
  });

  it("faktur lebih murah: selisih Cr 1301, seimbang", () => {
    const lines = buildFakturLines(100, 90);
    expect(lines).toContainEqual({ code: "1301", debit: 0, credit: 10 });
    const { d, k } = sum(lines);
    expect(d).toBe(k);
  });

  it("nol semua -> kosong", () => {
    expect(buildFakturLines(0, 0)).toEqual([]);
  });
});

describe("sisaFakturable", () => {
  it("kurangi yang sudah difakturkan", () => {
    expect(sisaFakturable({ a: 5, b: 2 }, { a: 3, b: 2 })).toEqual({ a: 2 });
  });
});
