import { describe, expect, it } from "vitest";
import { adaSelisih, nilaiDiterima, qtyDiterima, qtyDiterimaPerItem } from "../penerimaan";

describe("qtyDiterima", () => {
  it("pakai qty_terima kalau ada", () => {
    expect(qtyDiterima({ qty: 10, qty_terima: 7 })).toBe(7);
  });
  it("qty_terima 0 (barang tidak datang) bukan fallback ke qty PO", () => {
    expect(qtyDiterima({ qty: 10, qty_terima: 0 })).toBe(0);
  });
  it("belum diterima → qty PO", () => {
    expect(qtyDiterima({ qty: 10 })).toBe(10);
    expect(qtyDiterima({ qty: 10, qty_terima: null })).toBe(10);
  });
});

describe("qtyDiterimaPerItem", () => {
  it("gabung baris item sama, abaikan baris tanpa master SKU", () => {
    expect(
      qtyDiterimaPerItem([
        { item_id: "a", qty: 5, qty_terima: 4 },
        { item_id: "a", qty: 2 },
        { item_id: null, qty: 9, qty_terima: 9 },
      ]),
    ).toEqual({ a: 6 });
  });
});

describe("nilaiDiterima", () => {
  it("Σ qty diterima × harga PO", () => {
    expect(
      nilaiDiterima([
        { qty: 6, qty_terima: 4, harga_beli: 52000 },
        { qty: 2, harga_beli: 1000 },
      ]),
    ).toBe(210000);
  });
});

describe("adaSelisih", () => {
  it("true kalau ada baris terima ≠ pesan", () => {
    expect(adaSelisih([{ qty: 6, qty_terima: 6 }, { qty: 2, qty_terima: 1 }])).toBe(true);
  });
  it("false kalau semua pas / belum diterima", () => {
    expect(adaSelisih([{ qty: 6, qty_terima: 6 }])).toBe(false);
    expect(adaSelisih([{ qty: 6 }])).toBe(false);
  });
});
