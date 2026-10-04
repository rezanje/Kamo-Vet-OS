import { describe, expect, it } from "vitest";
import { compoundCsv, inventoryCsv } from "../hpp-reports-export";
import type { CompoundReport, InventoryReport } from "../hpp-reports-server";

describe("financial report full CSV", () => {
  it("exports all 205 filtered rows independently of display page", () => {
    const rows = Array.from({ length: 205 }, (_, id) => ({ id: String(id), invoiceNo: `INV-${id}`, createdAt: "2026-10-04T12:00:00Z", branch: "Satu", doctor: "Dr A", name: "=unsafe", recipeId: `r-${id}`,
      formulaVersionId: "v1", version: null, qty: 2, revenue: 180, cost: id ? 50 : null, grossProfit: id ? 130 : null, margin: id ? 130 / 180 * 100 : null, paymentStatus: "DP" }));
    const csv = compoundCsv({ rows } as unknown as CompoundReport);
    expect(csv).toContain("INV-204");
    expect(csv.trimEnd().split("\r\n")).toHaveLength(206);
    expect(csv).toContain("HPP belum tersedia");
    expect(csv).toContain("'=unsafe");
    expect(csv).toContain("v1");
  });
  it("preserves unknown full value and priced subtotal with reconciliation context", () => {
    const csv = inventoryCsv({ rows: [{ itemId: "i", warehouseId: "w", branch: "Satu", warehouse: "Gudang", warehouseType: "VET", name: "Obat", code: "SKU", unit: "ml", stockQty: 3, layerQty: 2,
      difference: 1, unpricedQty: 0, pricedValue: 100, value: null, averageCost: null, flags: ["Selisih stok/lapisan"], itemActive: false, warehouseActive: false }] } as unknown as InventoryReport);
    expect(csv).toContain("Selisih stok/lapisan");
    expect(csv).toContain("100");
    expect(csv).toContain("Nonaktif");
    expect(csv).not.toContain("NaN");
  });
});
