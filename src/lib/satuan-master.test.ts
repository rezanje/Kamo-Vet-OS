import { describe, it, expect } from "vitest";
import { normalizeUnit, dedupeUnits } from "./satuan-master";

describe("normalizeUnit", () => {
  it("beda huruf besar-kecil & spasi jadi satu satuan", () => {
    expect(normalizeUnit("PCS")).toBe("pcs");
    expect(normalizeUnit("  Box ")).toBe("box");
    expect(normalizeUnit("sak  besar")).toBe("sak besar");
  });

  it("nilai bukan teks jadi string kosong, bukan 'undefined'", () => {
    expect(normalizeUnit(null)).toBe("");
    expect(normalizeUnit(undefined)).toBe("");
    expect(normalizeUnit("   ")).toBe("");
  });

  it("dipotong 20 karakter mengikuti batas kolom units.nama", () => {
    expect(normalizeUnit("a".repeat(30))).toHaveLength(20);
  });
});

describe("dedupeUnits", () => {
  it("varian penulisan yang sama menyatu jadi satu baris", () => {
    expect(dedupeUnits(["pcs", "PCS", " Pcs "])).toEqual(["pcs"]);
  });

  it("hasil urut abjad & baris kosong dibuang", () => {
    expect(dedupeUnits(["kg", "", "box", "  ", "pcs"])).toEqual(["box", "kg", "pcs"]);
  });

  it("daftar kosong tetap kosong", () => {
    expect(dedupeUnits([])).toEqual([]);
  });
});
