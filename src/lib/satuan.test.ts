import { describe, it, expect } from "vitest";
import { unitOptions, pickUnit, toBaseQty, toBaseCost, parseUnitDrafts } from "./satuan";

const base = { unit: "pcs", sell_price: 5000, buy_price: 3500 };
const box = { unit: "box", factor: 12, sell_price: 55000, buy_price: 40000 };

describe("unitOptions", () => {
  it("satuan dasar selalu pertama & berfaktor 1", () => {
    const opts = unitOptions(base, [box]);
    expect(opts[0]).toEqual({ unit: "pcs", factor: 1, sell_price: 5000, buy_price: 3500 });
    expect(opts[1].unit).toBe("box");
  });

  it("turunan diurut dari terkecil", () => {
    const opts = unitOptions({ unit: "gr", sell_price: 50 }, [
      { unit: "sak", factor: 25000, sell_price: 900000, buy_price: 0 },
      { unit: "kg", factor: 1000, sell_price: 45000, buy_price: 0 },
    ]);
    expect(opts.map((o) => o.unit)).toEqual(["gr", "kg", "sak"]);
  });

  it("turunan bernama sama dgn satuan dasar dibuang (faktor ambigu)", () => {
    expect(unitOptions(base, [{ unit: "pcs", factor: 99, sell_price: 1, buy_price: 0 }])).toHaveLength(1);
  });
});

describe("pickUnit", () => {
  it("satuan yg sudah dihapus dari master jatuh ke satuan dasar, bukan faktor 1 karangan", () => {
    const opts = unitOptions(base, [box]);
    expect(pickUnit(opts, "dus").unit).toBe("pcs");
    expect(pickUnit(opts, "box").factor).toBe(12);
  });
});

describe("konversi stok & cost", () => {
  it("2 box = 24 pcs keluar dari stok", () => {
    expect(toBaseQty(2, 12)).toBe(24);
  });

  it("harga beli per box jadi cost per pcs untuk layer FIFO", () => {
    expect(toBaseCost(40000, 12)).toBeCloseTo(3333.3333, 3);
  });

  it("faktor tidak valid diperlakukan 1 (tidak mengecilkan stok diam-diam)", () => {
    expect(toBaseQty(3, 0)).toBe(3);
    expect(toBaseCost(9000, Number.NaN)).toBe(9000);
  });
});

describe("parseUnitDrafts", () => {
  it("menolak faktor nol/negatif", () => {
    const { error } = parseUnitDrafts(JSON.stringify([{ unit: "box", factor: 0 }]), "pcs");
    expect(error).toMatch(/lebih dari 0/);
  });

  it("menolak satuan dobel, termasuk bentrok dgn satuan dasar (case-insensitive)", () => {
    expect(parseUnitDrafts(JSON.stringify([{ unit: "Box", factor: 12 }, { unit: "box", factor: 6 }]), "pcs").error)
      .toMatch(/dobel/);
    expect(parseUnitDrafts(JSON.stringify([{ unit: "PCS", factor: 10 }]), "pcs").error).toMatch(/dobel/);
  });

  it("baris tanpa nama satuan dilewati, JSON rusak = kosong", () => {
    expect(parseUnitDrafts(JSON.stringify([{ unit: "  ", factor: 5 }]), "pcs").rows).toEqual([]);
    expect(parseUnitDrafts("{bukan json", "pcs").rows).toEqual([]);
  });

  it("baris valid lolos dgn harga ternormalisasi", () => {
    const { rows, error } = parseUnitDrafts(
      JSON.stringify([{ unit: "box", factor: "12", sell_price: 55000, buy_price: -5 }]),
      "pcs",
    );
    expect(error).toBeNull();
    expect(rows).toEqual([{ unit: "box", factor: 12, sell_price: 55000, buy_price: 0 }]);
  });
});
