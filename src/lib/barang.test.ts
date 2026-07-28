import { describe, it, expect } from "vitest";
import { pesanSimpanGagal } from "./barang";

describe("pesanSimpanGagal", () => {
  it("unique violation tiap master jadi bahasa manusia", () => {
    expect(pesanSimpanGagal('duplicate key value violates unique constraint "units_nama_key"'))
      .toBe("Satuan dengan nama itu sudah ada");
    expect(pesanSimpanGagal('duplicate key value violates unique constraint "item_categories_name_key"'))
      .toBe("Kategori barang dengan nama itu sudah ada");
    expect(pesanSimpanGagal('duplicate key value violates unique constraint "supplier_categories_nama_key"'))
      .toBe("Kategori pemasok dengan nama itu sudah ada");
    expect(pesanSimpanGagal('duplicate key value violates unique constraint "asset_categories_nama_key"'))
      .toBe("Kategori aset dengan nama itu sudah ada");
    expect(pesanSimpanGagal('duplicate key value violates unique constraint "customer_categories_nama_key"'))
      .toBe("Golongan pelanggan dengan nama itu sudah ada");
  });

  it("pemetaan lama tetap jalan", () => {
    expect(pesanSimpanGagal('violates unique constraint "items_code_key"'))
      .toBe("Kode barang itu sudah dipakai barang lain");
    expect(pesanSimpanGagal('violates unique constraint "brands_name_key"'))
      .toBe("Merek dengan nama itu sudah ada");
  });

  it("error tak dikenal dilewatkan apa adanya biar tetap kelihatan", () => {
    expect(pesanSimpanGagal("connection reset by peer")).toBe("connection reset by peer");
  });
});
