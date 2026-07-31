import { describe, it, expect } from "vitest";
import { hitungUsulan, perluDipesan, kelompokPemasok, type BarangReorder } from "./reorder";

const b = (p: Partial<BarangReorder> = {}): BarangReorder => ({
  itemId: "i1", kode: "A1", nama: "Barang", satuan: "pcs",
  stok: 5, minStock: 20, minBuy: 0, buyUnit: null, faktorBeli: 1,
  hargaBeli: 1000, supplierId: "s1", supplierNama: "PT A", ...p,
});

describe("perluDipesan", () => {
  it("batas 0 = tidak diawasi, walau stok habis", () => {
    expect(perluDipesan({ stok: 0, minStock: 0 })).toBe(false);
  });
  it("stok pas di batas belum perlu dipesan", () => {
    expect(perluDipesan({ stok: 20, minStock: 20 })).toBe(false);
    expect(perluDipesan({ stok: 19, minStock: 20 })).toBe(true);
  });
});

describe("hitungUsulan", () => {
  it("kekurangan dihitung dari batas minimum, bukan dari nol", () => {
    expect(hitungUsulan(b()).kurang).toBe(15);
  });

  it("dibulatkan KE ATAS ke satuan beli — tidak bisa pesan 1,25 dus", () => {
    const u = hitungUsulan(b({ stok: 0, minStock: 15, faktorBeli: 12, buyUnit: "box" }));
    expect(u.qtyPesan).toBe(2); // 15/12 = 1,25 → 2 box
  });

  it("minimum beli pemasok jadi lantai, bukan pengganti kekurangan", () => {
    expect(hitungUsulan(b({ minBuy: 10 })).qtyPesan).toBe(15); // kurang 15 > minimum 10
    expect(hitungUsulan(b({ stok: 18, minBuy: 10 })).qtyPesan).toBe(10); // kurang 2 → naik ke 10
  });

  it("nilai dihitung dari harga per satuan beli", () => {
    const u = hitungUsulan(b({ stok: 0, minStock: 24, faktorBeli: 12, hargaBeli: 50000 }));
    expect([u.qtyPesan, u.nilai]).toEqual([2, 100000]);
  });

  it("faktor beli tidak valid tidak boleh bikin qty jadi Infinity", () => {
    expect(hitungUsulan(b({ faktorBeli: 0 })).qtyPesan).toBe(15);
  });
});

describe("kelompokPemasok", () => {
  it("satu grup per pemasok, tanpa pemasok ditaruh paling akhir", () => {
    const rows = [
      hitungUsulan(b({ itemId: "i1", supplierId: null, supplierNama: "—" })),
      hitungUsulan(b({ itemId: "i2", supplierId: "s2", supplierNama: "PT B" })),
      hitungUsulan(b({ itemId: "i3", supplierId: "s2", supplierNama: "PT B" })),
    ];
    const g = kelompokPemasok(rows);
    expect(g.map((x) => x.supplierNama)).toEqual(["PT B", "—"]);
    expect(g[0].rows).toHaveLength(2);
    expect(g[0].nilai).toBe(30000);
  });
});
