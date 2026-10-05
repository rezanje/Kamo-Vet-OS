import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCompoundReport, loadInventoryReport, ReportAccessError, ReportInputError, type ReportKind } from "./hpp-reports-server";
import { compoundCsv, inventoryCsv, compoundIngredientsCsv, compoundIngredientsTable, compoundTable, inventoryTable, reportWIB, type ReportTable } from "./hpp-reports-export";
import ExcelJS from "exceljs";
import { hariIniWIB } from "./tanggal";

export function hppReportError(error: unknown): { status: number; message: string } {
  if (error instanceof ReportAccessError) return { status: error.status, message: error.message };
  if (error instanceof ReportInputError) return { status: 400, message: error.message };
  return { status: 500, message: "Laporan belum bisa dibaca lengkap. Coba lagi atau pilih cakupan lebih kecil." };
}
export async function downloadHppReport(client: SupabaseClient, kind: ReportKind, request: Request): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    let csv: string, filename: string, title: string, readAt: string, context: string;
    let tables: { name: string; table: ReportTable }[];
    if (kind === "inventory") {
      const report = await loadInventoryReport(client,params);
      csv = inventoryCsv(report);
      filename = `nilai-persediaan-${hariIniWIB()}`;
      title = "Nilai persediaan FIFO saat ini";
      readAt = report.readAt;
      context = "Nilai lengkap dan HPP rata-rata tersedia hanya jika seluruh qty ber-HPP dan saldo cocok. Subtotal lapisan ber-HPP dapat belum lengkap.";
      tables = [{ name: "Persediaan", table: inventoryTable(report) }];
    } else {
      const report = await loadCompoundReport(client,params);
      csv = params.rincian === "bahan" ? compoundIngredientsCsv(report) : compoundCsv(report);
      filename = `margin-racikan-${report.filters.dari}-${report.filters.sampai}${params.rincian === "bahan" ? "-bahan" : ""}`;
      title = `HPP dan margin racikan · ${report.filters.dari}–${report.filters.sampai} WIB`;
      readAt = report.readAt;
      context = "Penjualan setelah diskon item, sebelum alokasi diskon invoice dan pajak. Laba hanya dihitung untuk baris dengan HPP invoice. Nama/satuan bahan mengikuti resep saat dibaca dan dapat berubah pada racikan ad hoc. Qty resep tidak valid dikosongkan tanpa mengubah HPP invoice. HPP bahan berasal dari pemakaian historis; jika pembaca histori belum tersedia, qty mengikuti resep tersimpan dan HPP bahan dikosongkan. Dokter mengikuti kunjungan saat ini.";
      tables = [{ name: "Margin racikan", table: compoundTable(report) }, { name: "Bahan racikan", table: compoundIngredientsTable(report) }];
    }
    if (params.format === "xlsx") {
      const book = new ExcelJS.Workbook();
      for (const { name, table } of tables) {
        const sheet = book.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
        sheet.addRow(table.columns.map(column => column.label));
        sheet.getRow(1).font = { bold: true };
        table.rows.forEach(row => sheet.addRow(row.cells));
        table.columns.forEach((column,index) => {
          sheet.getColumn(index+1).width = column.format ? 20 : 28;
          if (column.format) sheet.getColumn(index+1).numFmt = column.format === "money" ? '#,##0.00' : '#,##0.########';
        });
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: table.columns.length } };
      }
      const info = book.addWorksheet("Keterangan");
      info.addRows([[title], ["Dibaca WIB", reportWIB(readAt)], ["Cakupan", context], ["Filter", JSON.stringify(params)]]);
      const buffer = await book.xlsx.writeBuffer();
      return new Response(new Uint8Array(buffer), { headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${filename}.xlsx"` } });
    }
    if (params.format === "print") {
      const escape = (value: unknown) => String(value ?? "—").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
      const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title>
        <style>body{font:11px Arial,sans-serif;color:#172033}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #ccd2dc;padding:5px;text-align:left}th{background:#f0f3f8}thead{display:table-header-group}tr{break-inside:avoid}@page{size:A3 landscape;margin:10mm}@media print{button{display:none}}</style></head><body>
        <button onclick="window.print()">Cetak / simpan PDF</button><h1>${escape(title)}</h1><p>Dibaca ${escape(reportWIB(readAt))} WIB · Semua baris sesuai filter</p><p>${escape(context)}</p><p>Filter: ${escape(JSON.stringify(params))}</p>
        ${tables.map(({ name, table }) => `<h2>${escape(name)}</h2><table><thead><tr>${table.columns.map(column => `<th>${escape(column.label)}</th>`).join("")}</tr></thead><tbody>${table.rows.map(row => `<tr>${row.cells.map(cell => `<td>${escape(typeof cell === "number" ? cell.toLocaleString("id-ID", { maximumFractionDigits: 8 }) : cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`).join("")}</body></html>`;
      return new Response(html, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self'" } });
    }
    return new Response(csv,{ headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}.csv"` } });
  } catch (error) {
    const failure = hppReportError(error);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
}
