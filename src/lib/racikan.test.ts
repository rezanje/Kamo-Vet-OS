import { describe, it, expect } from "vitest";
import { racikanTotal, type RacikanIngredient } from "./racikan";

describe("racikanTotal", () => {
  it("menjumlahkan harga × dosis tiap bahan", () => {
    const ings: RacikanIngredient[] = [
      { item_id: "a", nama: "Amoxicillin", qty: 10, satuan: "tablet", harga: 2000 },
      { item_id: "b", nama: "Sirup", qty: 1, satuan: "botol", harga: 25000 },
    ];
    expect(racikanTotal(ings)).toBe(45000); // 10*2000 + 1*25000
  });

  it("mengabaikan qty/harga negatif atau NaN (dianggap 0)", () => {
    const ings: RacikanIngredient[] = [
      { item_id: "a", nama: "x", qty: -5, satuan: "ml", harga: 1000 },
      { item_id: "b", nama: "y", qty: 2, satuan: "ml", harga: Number.NaN },
    ];
    expect(racikanTotal(ings)).toBe(0);
  });

  it("racikan kosong = 0", () => {
    expect(racikanTotal([])).toBe(0);
  });
});
