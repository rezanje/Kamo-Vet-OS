import { describe, expect, it } from "vitest";
import { rincianPromoLayar } from "../rincian-promo-layar";

describe("rincianPromoLayar", () => {
  it("groups automatic promo cuts by promo with the affected item names", () => {
    const hasil = [
      { item_id: "a", potongan: 15000, qtyKena: 1, promoId: "p1", promoName: "Member Bronze" },
      { item_id: "b", potongan: 12000, qtyKena: 2, promoId: "p1", promoName: "Member Bronze" },
      { item_id: "c", potongan: 5000, qtyKena: 1, promoId: "p2", promoName: "Promo Vaksin" },
    ];
    const baris = [
      { item_id: "a", deskripsi: "Vaksin F4" },
      { item_id: "b", deskripsi: "Obat cacing " },
      { item_id: "c", deskripsi: "Grooming" },
      { item_id: null, deskripsi: "Manual" },
    ];
    expect(rincianPromoLayar(hasil, baris)).toEqual([
      { promoId: "p1", nama: "Member Bronze", barang: ["Vaksin F4", "Obat cacing"], potongan: 27000 },
      { promoId: "p2", nama: "Promo Vaksin", barang: ["Grooming"], potongan: 5000 },
    ]);
  });

  it("returns nothing when no promo applies", () => {
    expect(rincianPromoLayar([], [{ item_id: "a", deskripsi: "X" }])).toEqual([]);
  });
});
