import { describe, expect, it } from "vitest";
import { kekuranganStok } from "../stok-keranjang";

const stok = new Map([["a", { stok: 5, unit: "pcs" }], ["b", { stok: 20, unit: "ml" }]]);
describe("kekuranganStok", () => {
  it("flags medicine rows above stock, using the unit factor and summing duplicates", () => {
    expect(kekuranganStok([
      { item_id: "a", nama_obat: "Obat A", qty: 3, faktor: 1, jenis: "obat" },
      { item_id: "a", nama_obat: "Obat A", qty: 3, faktor: 1, jenis: "obat" },
      { item_id: "b", nama_obat: "Sirup B", qty: 1, faktor: 10, jenis: "obat" },
    ], stok)).toEqual(["Obat A: butuh 6 pcs, stok 5 pcs"]);
  });
  it("ignores services, compounds and unknown items", () => {
    expect(kekuranganStok([
      { item_id: "a", nama_obat: "Jasa", qty: 9, faktor: 1, jenis: "jasa" },
      { item_id: "a", nama_obat: "Racik", qty: 9, faktor: 1, jenis: "racikan" },
      { item_id: "x", nama_obat: "Manual", qty: 9, faktor: 1, jenis: "obat" },
    ], stok)).toEqual([]);
  });
});
