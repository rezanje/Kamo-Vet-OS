import { describe, expect, it } from "vitest";
import { partitionDirectPurchaseLines, validateDirectPurchaseLines, type DirectPurchaseLine } from "../direct-purchase-lines";

const stock: DirectPurchaseLine = { kind: "stock", itemId: "item", name: "Obat", qty: 2, price: 10_000, unit: "pcs", factor: 1, expiryDate: null };
const asset: DirectPurchaseLine = { kind: "fixed_asset", name: "USG", categoryId: "cat", usefulLifeMonths: 60, residualValue: 0, price: 50_000_000, location: "Ruang Periksa" };

describe("baris faktur pembelian langsung", () => {
  it("mendukung faktur aset saja tanpa gudang", () => expect(() => validateDirectPurchaseLines([asset], null)).not.toThrow());
  it("mewajibkan gudang bila ada barang stok", () => expect(() => validateDirectPurchaseLines([stock], null)).toThrow(/Gudang/));
  it("mendukung faktur campuran dan memisahkan stok dari aset", () => {
    validateDirectPurchaseLines([stock, asset], "gudang");
    const parts = partitionDirectPurchaseLines([stock, asset]);
    expect(parts.stock).toHaveLength(1);
    expect(parts.assets).toHaveLength(1);
  });
  it("satu baris aset selalu menghasilkan satu aset individual", () => {
    expect(partitionDirectPurchaseLines([asset, { ...asset, name: "X-Ray" }]).assets.map((x) => x.name)).toEqual(["USG", "X-Ray"]);
  });
});
