import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { reportCsv } from "@/lib/csv-report";
import { hppReportError } from "@/lib/hpp-reports-download";
import { ReportInputError } from "@/lib/hpp-reports-server";
import { loadOpnamePriceReport } from "@/lib/opname-price-report";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const asCell = (value: string | null): string | number => {
  if (value === null) return "Tidak tersedia";
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isSafeInteger(Math.round(number * 100))) throw new ReportInputError("Nilai laporan terlalu besar untuk diekspor sebagai angka tanpa kehilangan ketelitian");
  return number;
};

export async function GET(request: Request) {
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    if (!params.order) throw new ReportInputError("Pilih satu hasil stok opname terlebih dahulu");
    const report = await loadOpnamePriceReport(await createClient(), params);
    if (!report.selected) throw new ReportInputError("Hasil stok opname tidak ditemukan");
    if (report.legacy) throw new ReportInputError("Hasil lama tidak memiliki snapshot harga saat posting; ekspor harga tidak tersedia");
    const basis = report.filters.dasar === "modal" ? "Modal FIFO saat posting" : "Harga jual cabang saat posting";
    const columns = ["Hasil", "Perintah", "Tanggal", "Cabang", "Gudang", "Cakupan", "Kode", "Barang", "Satuan", "Qty sistem", "Qty fisik", "Selisih", basis, "Nilai selisih", "Sumber nilai"];
    const rows = report.shown.map(row => [report.selected!.resultNo, report.selected!.orderNo, report.selected!.date,
      report.selected!.branch, report.selected!.warehouse, report.scope ?? "Tidak tersedia", row.code, row.name, row.unit,
      row.systemQty, row.physicalQty, row.difference,
      asCell(report.filters.dasar === "modal" ? row.unitCost : row.branchPrice),
      asCell(report.filters.dasar === "modal" ? row.modalDifference : row.saleDifference),
      report.filters.dasar === "modal" ? row.modalDifferenceSource : "Harga jual referensi cabang; bukan jurnal/faktur"]);
    const info: (string | number)[][] = [
      ["Hasil stok opname", report.selected.resultNo], ["Perintah", report.selected.orderNo], ["Tanggal posting", report.selected.date],
      ["Cabang", report.selected.branch], ["Gudang", report.selected.warehouse], ["Lingkup", report.scope ?? "Tidak tersedia"],
      ["Basis harga", basis], ["Filter selisih", report.filters.arah], ["Jumlah baris sesuai filter", report.shown.length],
      ["Nilai lebih", asCell(report.plus)], ["Nilai kurang", asCell(report.minus)], ["Nilai neto", asCell(report.net)],
      ["Baris tanpa nilai", report.unavailable],
      ["Catatan", report.legacy ? "Snapshot harga historis tidak tersedia; tidak memakai harga master sekarang" :
        report.filters.dasar === "modal" ? "Modal satuan pada selisih kurang adalah HPP FIFO keluar per unit; selisih lebih memakai biaya masuk/acuan PO per unit. Barang tanpa selisih memakai rata-rata nilai lapisan setelah posting. Nilai selisih sesuai posting asal." :
          "Harga jual cabang adalah referensi saat posting, bukan dasar jurnal atau faktur selisih."],
      ["Koreksi sesudah posting", report.revision ? `Revisi ${report.revision} tidak mengubah snapshot asli` : "Tidak ada yang tercatat"],
    ];
    const filename = `hasil-opname-${report.selected.resultNo.replace(/[^A-Za-z0-9.-]/g, "-")}-${report.filters.dasar}`;
    if (params.format === "xlsx") {
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet("Hasil opname", { views: [{ state: "frozen", ySplit: 1 }] });
      sheet.addRow(columns); sheet.getRow(1).font = { bold: true };
      sheet.addRows(rows);
      columns.forEach((_, index) => {
        sheet.getColumn(index + 1).width = index >= 9 && index <= 13 ? 20 : 27;
        if (index >= 9 && index <= 13) sheet.getColumn(index + 1).numFmt = '#,##0.########';
      });
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
      book.addWorksheet("Ringkasan dan filter").addRows(info);
      const bytes = await book.xlsx.writeBuffer();
      return new Response(new Uint8Array(bytes), { headers: { ...headers,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
      } });
    }
    if (params.format !== "csv") throw new ReportInputError("Format unduhan tidak didukung");
    return new Response(reportCsv(columns, [...rows, [], ["Ringkasan dan filter"], ...info]), { headers: { ...headers,
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}.csv"`,
    } });
  } catch (error) {
    const failure = hppReportError(error);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
}
