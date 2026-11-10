import { describe, expect, it } from "vitest";
import { stokKurangKasir } from "../stok-kasir";

describe("kasir: barang yang stoknya kurang menahan pembayaran", () => {
  it("stok 0 atau minus = kurang; tersedia ditampilkan 0", () => {
    expect(stokKurangKasir([
      { item_id: "a", item_type: "Persediaan", nama: "Makanan A", qty: 2, faktor: 1, stok: 0 },
      { item_id: "b", item_type: "Persediaan", nama: "Makanan B", qty: 1, faktor: 1, stok: -4 },
    ])).toEqual([
      { kunci: "a", item_id: "a", nama: "Makanan A", butuh: 2, tersedia: 0 },
      { kunci: "b", item_id: "b", nama: "Makanan B", butuh: 1, tersedia: 0 },
    ]);
  });

  it("jumlah pas dengan stok boleh; lebih satu ditahan", () => {
    const baris = (qty: number) => [{ item_id: "a", item_type: "Persediaan", nama: "A", qty, faktor: 1, stok: 2 }];
    expect(stokKurangKasir(baris(2))).toEqual([]);
    expect(stokKurangKasir(baris(3))).toHaveLength(1);
  });

  it("baris berbeda satuan untuk barang yang sama dijumlahkan dalam satuan dasar", () => {
    expect(stokKurangKasir([
      { item_id: "a", item_type: "Persediaan", nama: "A", qty: 1, faktor: 12, stok: 15 },
      { item_id: "a", item_type: "Persediaan", nama: "A", qty: 4, faktor: 1, stok: 15 },
    ])).toEqual([{ kunci: "a", item_id: "a", nama: "A", butuh: 16, tersedia: 15 }]);
  });

  it("jasa, non-persediaan, dan stok tak dilacak tidak ditahan", () => {
    expect(stokKurangKasir([
      { item_id: "j", item_type: "Jasa", nama: "Grooming", qty: 1, stok: 0 },
      { item_id: "n", item_type: "Non-Persediaan", nama: "Kantong", qty: 1, stok: 0 },
      { item_id: "g", item_type: "Grup", nama: "Paket jasa", qty: 1, stok: null },
      { item_id: null, item_type: "Persediaan", nama: "Bebas", qty: 1, stok: 0 },
    ])).toEqual([]);
  });

  it("paket Grup ditahan bila komponennya hanya cukup untuk lebih sedikit paket", () => {
    expect(stokKurangKasir([{ item_id: "g", item_type: "Grup", nama: "Paket", qty: 3, faktor: 1, stok: 2 }]))
      .toEqual([{ kunci: "g", item_id: "g", nama: "Paket", butuh: 3, tersedia: 2 }]);
  });
});
