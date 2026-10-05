import type { CompoundReport, InventoryReport } from "./hpp-reports-server";
import { reportCsv } from "./csv-report";

export type ReportCell = string | number | null;
export type ReportColumn = { label: string; format?: "money" | "qty" | "percent" };
export type ReportTable = { columns: ReportColumn[]; rows: { id: string; cells: ReportCell[]; href?: string }[] };
export const reportWIB = (value: string) => new Date(value).toLocaleString("id-ID", {
  timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

export function inventoryTable(report: InventoryReport): ReportTable {
  return { columns: [
    { label: "Cabang" }, { label: "Gudang / tipe" }, { label: "Kode" }, { label: "Barang" }, { label: "Satuan dasar" },
    { label: "Qty stok", format: "qty" }, { label: "Qty lapisan", format: "qty" }, { label: "Selisih qty", format: "qty" },
    { label: "Qty tanpa HPP", format: "qty" }, { label: "Subtotal ber-HPP", format: "money" },
    { label: "Nilai lengkap", format: "money" }, { label: "HPP rata-rata", format: "money" },
    { label: "Status barang" }, { label: "Status gudang" }, { label: "Keterangan" },
  ], rows: report.rows.map(row => ({ id: `${row.warehouseId}:${row.itemId}`, cells: [
    row.branch, `${row.warehouse} / ${row.warehouseType}`, row.code, row.name, row.unit,
    row.stockQty, row.layerQty, row.difference, row.unpricedQty, row.pricedValue, row.value, row.averageCost,
    row.itemActive ? "Aktif" : "Nonaktif", row.warehouseActive ? "Aktif" : "Nonaktif", row.flags.join("; ") || "Lengkap",
  ] })) };
}
export function compoundTable(report: CompoundReport): ReportTable {
  return { columns: [
    { label: "Waktu WIB" }, { label: "Invoice" }, { label: "Cabang" }, { label: "Dokter kunjungan" }, { label: "Racikan" },
    { label: "ID resep" }, { label: "ID versi resmi" }, { label: "Revisi" }, { label: "Qty", format: "qty" },
    { label: "Penjualan setelah diskon item", format: "money" }, { label: "HPP historis", format: "money" },
    { label: "Laba kotor", format: "money" }, { label: "Margin %", format: "percent" }, { label: "Pembayaran" }, { label: "Cakupan HPP" },
  ], rows: report.rows.map(row => ({ id: row.id, href: `/klinik/pembayaran/${row.visitId}/invoice`, cells: [
    reportWIB(row.createdAt), row.invoiceNo, row.branch, row.doctor, row.name, row.recipeId,
    row.formulaVersionId ?? "Ad hoc", row.version, Number(row.qty), row.revenue, row.cost, row.grossProfit, row.margin,
    row.paymentStatus, row.cost === null ? "HPP belum tersedia" : "Lengkap",
  ] })) };
}
export function compoundIngredientsTable(report: CompoundReport): ReportTable {
  return { columns: [
    { label: "Waktu WIB" }, { label: "Invoice" }, { label: "Cabang" }, { label: "Dokter kunjungan" }, { label: "Racikan" },
    { label: "ID resep" }, { label: "ID versi resmi" }, { label: "Bahan" }, { label: "ID barang" }, { label: "Satuan dasar" },
    { label: "Qty bahan", format: "qty" }, { label: "Sumber qty" }, { label: "HPP satuan historis rata-rata", format: "money" },
    { label: "HPP bahan historis", format: "money" }, { label: "Cakupan rincian HPP" },
  ], rows: report.rows.flatMap(row => (row.ingredients?.length ? row.ingredients : [null]).map(ingredient => ({
    id: `${row.id}:${ingredient?.id ?? "missing"}`, href: `/klinik/pembayaran/${row.visitId}/invoice`, cells: [
      reportWIB(row.createdAt), row.invoiceNo, row.branch, row.doctor, row.name, row.recipeId, row.formulaVersionId ?? "Ad hoc",
      ingredient?.name ?? "Bahan belum tersedia", ingredient?.itemId ?? null, ingredient?.unit ?? null, ingredient?.qty ?? null,
      row.ingredientQtySource ?? "Resep tersimpan", ingredient?.averageCost ?? null, ingredient?.cost ?? null,
      row.ingredientCostComplete ? "Cocok dengan HPP invoice" : "Rincian HPP belum lengkap / belum cocok",
    ],
  }))) };
}
export function compoundIngredientsCsv(report: CompoundReport): string { return tableCsv(compoundIngredientsTable(report)); }
function tableCsv(table: ReportTable): string {
  return reportCsv(table.columns.map(column => column.label),table.rows.map(row => row.cells.map(cell => cell ?? "")));
}
export function compoundCsv(report: CompoundReport): string { return tableCsv(compoundTable(report)); }
export function inventoryCsv(report: InventoryReport): string { return tableCsv(inventoryTable(report)); }
