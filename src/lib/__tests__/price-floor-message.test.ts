import { describe, expect, it } from "vitest";
import { hargaMinimumUntuk, paketDiBawahHpp, parsePriceFloorRows } from "../price-floor-message";

// The exact text clinic_private.assert_invoice_price_floor raises (20261106860000), prefixed by klinik-posting.
const PESAN = [
  "Penjualan ditolak. Harga neto Infus Refill Rp20.000 di bawah HPP Rp29.578. Ada 3 baris yang ditolak; semuanya tercantum di bawah.",
  "- Infus Refill: harga neto Rp20.000 per pcs, HPP Rp29.578 per pcs, harga minimum Rp29.578 per pcs",
  "- Obat Racik Probiotik (racikan): harga neto Rp50.000 per racikan, HPP Rp50.151 per racikan, harga minimum Rp50.151 per racikan",
  "- Paket Steril (paket): harga neto Rp800 untuk seluruh paket, total HPP komponen Rp1.000, harga minimum paket Rp1.000",
  "Naikkan Harga di baris tersebut atau ubah Harga jual di Barang & Jasa. Mengubah Harga jual di Barang & Jasa tidak mengubah baris di tagihan yang sudah terbuka.",
].join("\n");

describe("parsePriceFloorRows", () => {
  it("reads every offending row with name, net, HPP and minimum price per unit", () => {
    const rows = parsePriceFloorRows(PESAN);
    expect(rows).toEqual([
      { kind: "row", name: "Infus Refill", net: 20000, hpp: 29578, minimum: 29578, unit: "pcs" },
      { kind: "racikan", name: "Obat Racik Probiotik", net: 50000, hpp: 50151, minimum: 50151, unit: "racikan" },
      { kind: "paket", name: "Paket Steril", net: 800, hpp: 1000, minimum: 1000, unit: null },
    ]);
  });
  it("returns nothing for other errors, empty input and the old single-line message", () => {
    expect(parsePriceFloorRows(null)).toEqual([]);
    expect(parsePriceFloorRows("")).toEqual([]);
    expect(parsePriceFloorRows("Stok tidak cukup")).toEqual([]);
    expect(parsePriceFloorRows("Penjualan ditolak. Harga neto Obat A Rp900 di bawah HPP Rp1.000. Naikkan harga atau kurangi diskon.")).toEqual([]);
  });
  it("keeps names containing colons or parentheses, and rows without a computable minimum", () => {
    const rows = parsePriceFloorRows([
      "- Vit C: 500 mg (strip): harga neto Rp900 per strip, HPP Rp1.000 per strip, harga minimum Rp1.000 per strip",
      "- Gratis: harga neto Rp0 per pcs, HPP belum tersedia, harga minimum tidak dapat dihitung (diskon invoice 100%)",
    ].join("\n"));
    expect(rows).toEqual([
      { kind: "row", name: "Vit C: 500 mg (strip)", net: 900, hpp: 1000, minimum: 1000, unit: "strip" },
      { kind: "row", name: "Gratis", net: 0, hpp: null, minimum: null, unit: "pcs" },
    ]);
  });
  it("parses the C8 wordings: zero-subtotal row with a printed minimum, 100% row discount without one", () => {
    const rows = parsePriceFloorRows([
      "- Obat Gratis: harga neto Rp0 per pcs, HPP Rp1.000 per pcs, harga minimum Rp1.000 per pcs",
      "- Diskon Penuh: harga neto Rp0 per pcs, HPP Rp1.000 per pcs, harga minimum tidak dapat dihitung (diskon 100% pada baris)",
    ].join("\n"));
    expect(rows).toEqual([
      { kind: "row", name: "Obat Gratis", net: 0, hpp: 1000, minimum: 1000, unit: "pcs" },
      { kind: "row", name: "Diskon Penuh", net: 0, hpp: 1000, minimum: null, unit: "pcs" },
    ]);
    expect(hargaMinimumUntuk(rows, { deskripsi: "Obat Gratis", harga: 0 })).toBe(1000);
    expect(hargaMinimumUntuk(rows, { deskripsi: "Diskon Penuh", harga: 5 })).toBe(0);
  });
  it("ignores the 'dan N baris lain lagi' tail and hint sentences", () => {
    expect(parsePriceFloorRows("dan 5 baris lain lagi.\nHPP belum tersedia untuk: A, B\nNaikkan Harga di baris tersebut.")).toEqual([]);
  });
});

describe("hargaMinimumUntuk", () => {
  const rows = parsePriceFloorRows(PESAN);
  it("flags a row of that name while its price is below the minimum, and releases it once corrected", () => {
    expect(hargaMinimumUntuk(rows, { deskripsi: "Infus Refill", harga: 20000 })).toBe(29578);
    expect(hargaMinimumUntuk(rows, { deskripsi: "  Infus   Refill ", harga: 29577 })).toBe(29578);
    expect(hargaMinimumUntuk(rows, { deskripsi: "Infus Refill", harga: 29578 })).toBeNull();
    expect(hargaMinimumUntuk(rows, { deskripsi: "Injeksi Antibiotik", harga: 1 })).toBeNull();
  });
  it("matches a racikan only as a racikan and a plain row only as a plain row", () => {
    expect(hargaMinimumUntuk(rows, { deskripsi: "Obat Racik Probiotik", harga: 50000, recipe_id: "r1" })).toBe(50151);
    expect(hargaMinimumUntuk(rows, { deskripsi: "Obat Racik Probiotik", harga: 50000, recipe_id: null })).toBeNull();
    expect(hargaMinimumUntuk(rows, { deskripsi: "Infus Refill", harga: 20000, recipe_id: "r1" })).toBeNull();
  });
  it("a row whose minimum cannot be computed stays flagged by name", () => {
    const sisa = parsePriceFloorRows("- Gratis: harga neto Rp0 per pcs, HPP belum tersedia, harga minimum tidak dapat dihitung (diskon invoice 100%)");
    expect(hargaMinimumUntuk(sisa, { deskripsi: "Gratis", harga: 5 })).toBe(0);
  });
});

describe("paketDiBawahHpp", () => {
  it("returns the package minimum for a package named in the error", () => {
    const rows = parsePriceFloorRows(PESAN);
    expect(paketDiBawahHpp(rows, "Paket Steril")).toBe(1000);
    expect(paketDiBawahHpp(rows, "Paket Lain")).toBeNull();
  });
});
