import { describe, expect, it } from "vitest";
import { adaSelisih, formatNoTerima, hitungBarisTerima, nilaiDiterima, qtyDiterima, qtyDiterimaPerItem } from "../penerimaan";

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

describe("formatNoTerima", () => {
  it("format TB.YYYY.MM.NNNNN", () => {
    expect(formatNoTerima(new Date(2026, 7, 3), 1)).toBe("TB.2026.08.00001");
    expect(formatNoTerima(new Date(2026, 11, 31), 123)).toBe("TB.2026.12.00123");
  });
});

describe("hitungBarisTerima", () => {
  const b = (o: Partial<Parameters<typeof hitungBarisTerima>[0]> = {}) =>
    hitungBarisTerima({ qty: 10, sudahTerima: 0, mintaTerima: 0, mintaRusak: 0, harga: 1000, ...o });

  it("terima penuh", () => {
    expect(b({ mintaTerima: 10 })).toMatchObject({ terima: 10, rusak: 0, totalTerima: 10, nilai: 10_000 });
  });

  it("kiriman bertahap: sisa dihitung dari yang sudah pernah datang", () => {
    expect(b({ sudahTerima: 4, mintaTerima: 6 })).toMatchObject({ sisaSebelum: 6, terima: 6, totalTerima: 10 });
  });

  it("tidak boleh terima melebihi sisa pesanan", () => {
    expect(b({ sudahTerima: 8, mintaTerima: 5 })).toMatchObject({ terima: 2, totalTerima: 10 });
  });

  it("barang rusak tidak masuk stok dan tidak dijurnal", () => {
    const r = b({ mintaTerima: 7, mintaRusak: 3 });
    expect(r).toMatchObject({ terima: 7, rusak: 3, totalTerima: 7 });
    expect(r.nilai).toBe(7_000);
  });

  it("rusak tidak mengurangi sisa pesanan — pemasok masih wajib kirim pengganti", () => {
    const r = b({ mintaTerima: 2, mintaRusak: 3 });
    expect(r.totalTerima).toBe(2);           // sisa yang ditunggu tetap 8, bukan 5
  });

  it("total yang datang dibatasi qty pesanan", () => {
    expect(b({ mintaTerima: 8, mintaRusak: 5 })).toMatchObject({ terima: 8, rusak: 2 });
  });

  it("angka negatif atau sampah dianggap nol", () => {
    expect(b({ mintaTerima: -5, mintaRusak: Number.NaN })).toMatchObject({ terima: 0, rusak: 0, nilai: 0 });
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
