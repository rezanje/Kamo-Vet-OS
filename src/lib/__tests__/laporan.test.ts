import { describe, expect, it } from "vitest";
import { aggPenjualanPerBarang, pivotStokPerGudang, resolveUnitTypes } from "../laporan";

describe("pivotStokPerGudang", () => {
  it("pivot barang x gudang + total", () => {
    const { gudang, items } = pivotStokPerGudang([
      { item_id: "a", code: "A", name: "Alpha", unit: "pcs", wh_code: "WH1", qty: 3 },
      { item_id: "a", code: "A", name: "Alpha", unit: "pcs", wh_code: "WH2", qty: 7 },
      { item_id: "b", code: "B", name: "Beta", unit: "sak", wh_code: "WH2", qty: 5 },
    ]);
    expect(gudang).toEqual(["WH1", "WH2"]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ name: "Alpha", per: { WH1: 3, WH2: 7 }, total: 10 });
    expect(items[1]).toMatchObject({ name: "Beta", per: { WH2: 5 }, total: 5 });
  });
});

describe("aggPenjualanPerBarang", () => {
  it("agregat qty & omzet, urut omzet desc", () => {
    const out = aggPenjualanPerBarang([
      { nama: "X", qty: 2, harga: 1000 },
      { nama: "Y", qty: 1, harga: 5000 },
      { nama: "X", qty: 3, harga: 1000 },
    ]);
    expect(out[0]).toEqual({ nama: "X", qty: 5, omzet: 5000 });
    expect(out[1]).toEqual({ nama: "Y", qty: 1, omzet: 5000 });
  });
});

describe("resolveUnitTypes", () => {
  it("unit:KLINIK / unit:PETSHOP / lainnya", () => {
    expect(resolveUnitTypes("unit:KLINIK")).toEqual(["KLINIK", "BOTH"]);
    expect(resolveUnitTypes("unit:PETSHOP")).toEqual(["PETSHOP", "BOTH"]);
    expect(resolveUnitTypes("some-uuid")).toBeNull();
    expect(resolveUnitTypes(undefined)).toBeNull();
  });
});
