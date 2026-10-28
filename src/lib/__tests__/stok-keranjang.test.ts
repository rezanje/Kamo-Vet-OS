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
  it("flags procedure BMHP above stock, e.g. the vaccine vial of Vaksinasi F3", () => {
    const vial = new Map([["vial", { stok: 0, unit: "VIAL" }], ["spuit", { stok: 274, unit: "PCS" }]]);
    expect(kekuranganStok([
      { item_id: "jv", nama_obat: "Vaksinasi F3", qty: 1, faktor: 1, jenis: "jasa",
        bmhp: [{ item_id: "vial", nama: "Vaccine F3", qty: 1, unit: "VIAL" }, { item_id: "spuit", nama: "Syringe", qty: 1, unit: "PCS" }] },
    ], vial)).toEqual(["Vaccine F3: butuh 1 VIAL, stok 0 VIAL"]);
  });
  it("sums BMHP with medicine lines of the same item and applies the BMHP unit factor", () => {
    expect(kekuranganStok([
      { item_id: "b", nama_obat: "Sirup B", qty: 1, faktor: 10, jenis: "obat" },
      { item_id: "jv", nama_obat: "Tindakan", qty: 1, faktor: 1, jenis: "jasa", bmhp: [{ item_id: "b", nama: "Sirup B", qty: 2, unit: "btl" }] },
    ], stok, (_id, unit) => unit === "btl" ? 10 : 1)).toEqual(["Sirup B: butuh 30 ml, stok 20 ml"]);
  });
  it("ignores services, compounds and unknown items", () => {
    expect(kekuranganStok([
      { item_id: "a", nama_obat: "Jasa", qty: 9, faktor: 1, jenis: "jasa" },
      { item_id: "a", nama_obat: "Racik", qty: 9, faktor: 1, jenis: "racikan" },
      { item_id: "x", nama_obat: "Manual", qty: 9, faktor: 1, jenis: "obat" },
    ], stok)).toEqual([]);
  });
});
