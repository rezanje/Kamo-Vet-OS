import { describe, expect, it } from "vitest";
import { buildFakturLangsungLines, buildFakturLines, formatNoFaktur, sisaFakturable } from "../faktur-beli";

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

  it("Mode PKP: PPN masukan Dr 1105, tetap seimbang", () => {
    // faktur 111 (inkl PPN 11), nilai PO 100 → Dr 2102 100, Dr 1105 11, Cr 2101 111
    const lines = buildFakturLines(100, 111, 11);
    expect(lines).toContainEqual({ code: "1105", debit: 11, credit: 0 });
    expect(lines.find((l) => l.code === "1301")).toBeUndefined(); // selisih 0
    const { d, k } = sum(lines);
    expect(d).toBe(k);
  });
});

describe("sisaFakturable", () => {
  it("kurangi yang sudah difakturkan", () => {
    expect(sisaFakturable({ a: 5, b: 2 }, { a: 3, b: 2 })).toEqual({ a: 2 });
  });
});

// ── Faktur pembelian LANGSUNG (tanpa PO) ─────────────────────────────────────

describe("buildFakturLangsungLines", () => {
  it("tanpa PPN: persediaan bertambah sebesar total, utang sebesar total", () => {
    expect(buildFakturLangsungLines(1_000_000, 0)).toEqual([
      { code: "1301", debit: 1_000_000, credit: 0 },
      { code: "2101", debit: 0, credit: 1_000_000 },
    ]);
  });

  it("mode PKP: persediaan dinilai DPP, PPN masuk 1105, utang tetap total", () => {
    // PPN bisa dikreditkan, jadi ia bukan bagian harga pokok barang.
    expect(buildFakturLangsungLines(1_110_000, 110_000)).toEqual([
      { code: "1301", debit: 1_000_000, credit: 0 },
      { code: "1105", debit: 110_000, credit: 0 },
      { code: "2101", debit: 0, credit: 1_110_000 },
    ]);
  });

  it("selalu seimbang", () => {
    for (const [total, ppn] of [[500_000, 0], [1_110_000, 110_000], [99_999, 9_090]]) {
      const l = buildFakturLangsungLines(total, ppn);
      const d = l.reduce((a, x) => a + x.debit, 0);
      const k = l.reduce((a, x) => a + x.credit, 0);
      expect(d).toBe(k);
    }
  });

  it("tidak pernah memakai 2102 — barangnya belum pernah lewat GRNI", () => {
    expect(buildFakturLangsungLines(1_000_000, 0).some((l) => l.code === "2102")).toBe(false);
  });

  it("nilai nol/negatif tidak menghasilkan jurnal", () => {
    expect(buildFakturLangsungLines(0, 0)).toEqual([]);
    expect(buildFakturLangsungLines(-5, 0)).toEqual([]);
  });

  it("PPN yang melebihi total dijepit, jurnal tetap seimbang", () => {
    const l = buildFakturLangsungLines(100_000, 999_999);
    expect(l.reduce((a, x) => a + x.debit, 0)).toBe(100_000);
    expect(l.reduce((a, x) => a + x.credit, 0)).toBe(100_000);
  });
});
