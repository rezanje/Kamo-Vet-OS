import { describe, expect, it } from "vitest";
import { bahanKurang, hppPerUnit, kebutuhanBahan, rencanaJadi } from "../produksi";

const resep = [
  { item_id: "plastik", nama: "Plastik", qty: 1 },
  { item_id: "isiA", nama: "Isi A", qty: 0.5 },
];

describe("kebutuhanBahan", () => {
  it("dikali batch", () => {
    expect(kebutuhanBahan(resep, 500)).toEqual([
      { item_id: "plastik", nama: "Plastik", qty: 500 },
      { item_id: "isiA", nama: "Isi A", qty: 250 },
    ]);
  });
  it("batch nol / negatif = tidak ada kebutuhan", () => {
    expect(kebutuhanBahan(resep, 0)).toEqual([]);
    expect(kebutuhanBahan(resep, -3)).toEqual([]);
  });
});

describe("rencanaJadi", () => {
  it("output resep × batch", () => {
    expect(rencanaJadi(500, 2)).toBe(1000);
    expect(rencanaJadi(0, 5)).toBe(0);
  });
});

describe("hppPerUnit", () => {
  it("modal bahan dibagi qty yang benar-benar jadi", () => {
    expect(hppPerUnit(1_000_000, 500)).toBe(2000);
    // Rencana 500, yang jadi 400 → modalnya menempel di 400 unit.
    expect(hppPerUnit(1_000_000, 400)).toBe(2500);
  });
  it("gagal total tidak membagi nol", () => {
    expect(hppPerUnit(1_000_000, 0)).toBe(0);
    expect(hppPerUnit(0, 100)).toBe(0);
  });
});

describe("bahanKurang", () => {
  it("menyebut bahan yang stoknya tidak cukup", () => {
    const stok = new Map([["plastik", 400], ["isiA", 999]]);
    expect(bahanKurang(kebutuhanBahan(resep, 500), stok)).toEqual([
      { item_id: "plastik", nama: "Plastik", butuh: 500, ada: 400 },
    ]);
  });
  it("stok pas dianggap cukup", () => {
    const stok = new Map([["plastik", 500], ["isiA", 250]]);
    expect(bahanKurang(kebutuhanBahan(resep, 500), stok)).toEqual([]);
  });
});
