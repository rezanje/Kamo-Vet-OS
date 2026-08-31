import { describe, expect, it } from "vitest";
import { duplicateStockKeys, reconcileInitialStock, toBaseStock } from "../impor-saldo-accurate";

describe("toBaseStock", () => {
  it("mengubah qty dan HPP ke satuan dasar tanpa mengubah nilai", () => {
    expect(toBaseStock({ qty: 2, factor: 25, unitCost: 450_000 }))
      .toEqual({ baseQty: 50, baseUnitCost: 18_000, value: 900_000 });
  });
});

describe("reconcileInitialStock", () => {
  it("mendeteksi selisih qty, layer, move, dan nilai", () => {
    expect(reconcileInitialStock({
      sourceQty: 10,
      stockQty: 10,
      layerQty: 9,
      moveQty: 10,
      sourceValue: 1000,
      layerValue: 900,
    }).ok).toBe(false);
  });
});

describe("duplicateStockKeys", () => {
  it("menolak baris saldo kembar pada gudang, barang, batch, dan expiry sama", () => {
    const issues = duplicateStockKeys([
      { row: 2, warehouseId: "w", itemId: "i", batchNo: "B1", expDate: "2027-01-01" },
      { row: 3, warehouseId: "w", itemId: "i", batchNo: "B1", expDate: "2027-01-01" },
    ]);
    expect(issues.map((i) => i.row)).toEqual([2, 3]);
  });
});
