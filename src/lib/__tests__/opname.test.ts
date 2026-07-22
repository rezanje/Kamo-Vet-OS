import { describe, expect, it } from "vitest";
import { formatNoOpname, nilaiSelisih } from "../opname";

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
