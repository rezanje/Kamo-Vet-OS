export type DirectStockLine = {
  kind: "stock"; itemId: string; name: string; qty: number; price: number;
  unit: string; factor: number; expiryDate: string | null;
};
export type DirectAssetLine = {
  kind: "fixed_asset"; name: string; categoryId: string; usefulLifeMonths: number;
  residualValue: number; price: number; location: string | null;
};
export type DirectPurchaseLine = DirectStockLine | DirectAssetLine;

export function validateDirectPurchaseLines(lines: DirectPurchaseLine[], warehouseId: string | null): void {
  if (!lines.length) throw new Error("Isi minimal satu baris pembelian");
  for (const line of lines) {
    if (line.kind === "stock") {
      if (!warehouseId) throw new Error("Gudang wajib untuk baris barang stok");
      if (!line.itemId || line.qty <= 0 || line.price < 0) throw new Error("Baris barang stok tidak valid");
    } else if (!line.name || !line.categoryId || line.usefulLifeMonths <= 0 || line.price <= 0 || line.residualValue < 0 || line.residualValue >= line.price) {
      throw new Error("Baris aset tetap tidak valid");
    }
  }
}

export function partitionDirectPurchaseLines(lines: DirectPurchaseLine[]) {
  return {
    stock: lines.filter((line): line is DirectStockLine => line.kind === "stock"),
    assets: lines.filter((line): line is DirectAssetLine => line.kind === "fixed_asset"),
  };
}

