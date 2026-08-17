import { describe, expect, it } from "vitest";
import {
  barangKurang,
  formatNoOpname,
  nilaiFakturSelisih,
  nilaiSelisih,
  pakaiHargaJual,
} from "../opname";

describe("formatNoOpname", () => {
  it("format OPO/OPR.NNNNN", () => {
    expect(formatNoOpname("OPO", 385)).toBe("OPO.00385");
    expect(formatNoOpname("OPR", 1)).toBe("OPR.00001");
  });
});

describe("nilaiSelisih", () => {
  it("pisahkan nilai lebih dan kurang", () => {
    expect(
      nilaiSelisih([
        { qty_sistem: 10, qty_fisik: 12, buy_price: 1000 }, // lebih 2 → 2000
        { qty_sistem: 5, qty_fisik: 3, buy_price: 500 },    // kurang 2 → 1000
        { qty_sistem: 7, qty_fisik: 7, buy_price: 9999 },   // sama → 0
      ]),
    ).toEqual({ lebih: 2000, kurang: 1000 });
  });
  it("kosong = nol", () => {
    expect(nilaiSelisih([])).toEqual({ lebih: 0, kurang: 0 });
  });
});

describe("pakaiHargaJual", () => {
  it("gudang klinik pakai modal walau cabangnya campuran", () => {
    expect(pakaiHargaJual({ branchType: "BOTH", warehouseType: "VET" })).toBe(false);
  });
  it("gudang toko pakai harga jual walau cabangnya klinik", () => {
    expect(pakaiHargaJual({ branchType: "KLINIK", warehouseType: "RETAIL" })).toBe(true);
  });
  it("tanpa jenis gudang, ikut jenis cabang", () => {
    expect(pakaiHargaJual({ branchType: "KLINIK", warehouseType: null })).toBe(false);
    expect(pakaiHargaJual({ branchType: "PETSHOP", warehouseType: null })).toBe(true);
  });
  it("tanpa keterangan apa pun dianggap toko", () => {
    expect(pakaiHargaJual({})).toBe(true);
  });
});

describe("barangKurang + nilaiFakturSelisih", () => {
  const rows = [
    { item_id: "a", qty_sistem: 10, qty_fisik: 7 },  // hilang 3
    { item_id: "b", qty_sistem: 4, qty_fisik: 6 },   // lebih, bukan urusan faktur
    { item_id: "c", qty_sistem: 2, qty_fisik: 2 },
  ];

  it("hanya barang hilang yang masuk faktur", () => {
    expect(barangKurang(rows)).toEqual([{ item_id: "a", qty: 3 }]);
  });

  it("dinilai harga jual normal", () => {
    const harga = new Map([["a", 25_000], ["b", 9_000]]);
    expect(nilaiFakturSelisih(barangKurang(rows), harga)).toBe(75_000);
  });

  it("barang tanpa harga jual dihitung nol, bukan NaN", () => {
    expect(nilaiFakturSelisih([{ item_id: "z", qty: 5 }], new Map())).toBe(0);
  });
});
