// F1-a (meeting 12 Nov 2026): unduhan Hasil Stok Opname dibentuk di server dari data & saringan yang SAMA
// dengan halaman (loadOpnamePriceReport: sesi, OWNER/FINANCE aktif, akses efektif akun, izin cabang).
// Isi: rekap periode per cabang/gudang (HPP dan harga jual berdampingan) dan — bila satu dokumen dipilih —
// rinciannya dengan HPP, harga jual, dan selisih keduanya. Sel teks diamankan dari rumus (amankanSel).
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { reportCsv } from "@/lib/csv-report";
import { hppReportError } from "@/lib/hpp-reports-download";
import { ReportInputError } from "@/lib/hpp-reports-server";
import { amankanSel } from "@/lib/laporan-kategori-penjualan";
import { hppLabel, loadOpnamePriceReport, methodLabel, selisihJualHpp, type OpnameRecapGroup } from "@/lib/opname-price-report";

type Sel = string | number;
type Lembar = { nama: string; kolom: string[]; baris: Sel[][]; angka: number[] };

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const asCell = (value: string | null): string | number => {
  if (value === null) return "Tidak tersedia";
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isSafeInteger(Math.round(number * 100))) throw new ReportInputError("Nilai laporan terlalu besar untuk diekspor sebagai angka tanpa kehilangan ketelitian");
  return number;
};
const ARAH: Record<string, string> = { semua: "Semua", lebih: "Lebih", kurang: "Kurang", sama: "Sama" };

export async function GET(request: Request) {
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    if (params.format !== "csv" && params.format !== "xlsx") throw new ReportInputError("Format unduhan tidak didukung");
    const report = await loadOpnamePriceReport(await createClient(), params);
    if (params.order && report.legacy) throw new ReportInputError("Hasil lama tidak memiliki snapshot harga saat posting; ekspor harga tidak tersedia");
    const hppPeriode = hppLabel(report.recap.methods);
    const rekapBaris = (row: OpnameRecapGroup, total = false): Sel[] => [total ? "Total" : row.branch, total ? "" : row.warehouse,
      row.documents, row.withoutSnapshot, row.corrected, row.plusCount, asCell(row.modal.plus), asCell(row.jual.plus),
      row.minusCount, asCell(row.modal.minus), asCell(row.jual.minus), asCell(row.modal.net), asCell(row.jual.net), asCell(row.gap)];
    const lembar: Lembar[] = [{
      nama: "Rekap periode",
      kolom: ["Cabang", "Gudang", "Dokumen", "Tanpa snapshot", "Pernah dikoreksi", "Baris lebih", `Lebih (${hppPeriode})`, "Lebih (harga jual)",
        "Baris kurang", `Kurang (${hppPeriode})`, "Kurang (harga jual)", `Neto (${hppPeriode})`, "Neto (harga jual)", "Selisih jual − HPP"],
      baris: report.recap.groups.length ? [...report.recap.groups.map(row => rekapBaris(row)), rekapBaris(report.recap.total, true)] : [],
      angka: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    }];
    const selected = report.selected;
    const hppDok = hppLabel([report.method]);
    if (selected) lembar.push({
      nama: "Hasil opname",
      kolom: ["Hasil", "Perintah", "Tanggal", "Cabang", "Gudang", "Cakupan", "Kode", "Barang", "Satuan", "Qty sistem", "Qty fisik", "Selisih",
        `${hppDok} satuan`, `Nilai selisih ${hppDok}`, "Harga jual cabang", "Nilai selisih harga jual", "Selisih jual − HPP", `Sumber ${hppDok}`],
      baris: report.shown.map(row => [selected.resultNo, selected.orderNo, selected.date, selected.branch, selected.warehouse,
        report.scope ?? "Tidak tersedia", row.code, row.name, row.unit, row.systemQty, row.physicalQty, row.difference,
        asCell(row.unitCost), asCell(row.modalDifference), asCell(row.branchPrice), asCell(row.saleDifference),
        asCell(selisihJualHpp(row.saleDifference, row.modalDifference)), row.modalDifferenceSource]),
      angka: [9, 10, 11, 12, 13, 14, 15, 16],
    });
    const info: Sel[][] = [
      ["Laporan", "Hasil Stok Opname"], ["Dari tanggal", report.filters.dari], ["Sampai tanggal", report.filters.sampai],
      ["Cabang", report.filters.cabang ? report.branches.find(row => row.id === report.filters.cabang)?.name ?? report.filters.cabang : "Semua cabang yang diizinkan"],
      ["Dokumen opname pada periode", report.entries.length],
      ["Metode HPP", report.recap.methods.map(methodLabel).join(", ") || "Tidak tersedia"],
      ["Total neto " + hppPeriode, asCell(report.recap.total.modal.net)], ["Total neto harga jual", asCell(report.recap.total.jual.net)],
      ["Catatan rekap", "Angka dari snapshot posting awal; koreksi stok sesudahnya tidak mengubah rekap. HPP = nilai yang dijurnal; harga jual cabang hanya pembanding, bukan dasar jurnal/faktur."],
      ...(selected ? [
        ["Hasil stok opname", selected.resultNo], ["Perintah", selected.orderNo], ["Tanggal posting", selected.date],
        ["Gudang", selected.warehouse], ["Lingkup", report.scope ?? "Tidak tersedia"], ["Metode HPP dokumen", methodLabel(report.method) || "Tidak tersedia"],
        ["Filter selisih", ARAH[report.filters.arah]], ["Jumlah baris sesuai filter", report.shown.length],
        [`Nilai lebih ${hppDok}`, asCell(report.modal.plus)], ["Nilai lebih harga jual", asCell(report.jual.plus)],
        [`Nilai kurang ${hppDok}`, asCell(report.modal.minus)], ["Nilai kurang harga jual", asCell(report.jual.minus)],
        [`Nilai neto ${hppDok}`, asCell(report.modal.net)], ["Nilai neto harga jual", asCell(report.jual.net)],
        ["Selisih jual − HPP", asCell(selisihJualHpp(report.jual.net, report.modal.net))], ["Baris tanpa nilai HPP", report.modal.unavailable],
        ["Koreksi sesudah posting", report.revision ? `Revisi ${report.revision} tidak mengubah snapshot asli` : "Tidak ada yang tercatat"],
      ] as Sel[][] : []),
    ];
    const filename = selected ? `hasil-opname-${selected.resultNo.replace(/[^A-Za-z0-9.-]/g, "-")}` : `rekap-hasil-opname-${report.filters.dari}-${report.filters.sampai}`;
    if (params.format === "xlsx") {
      const book = new ExcelJS.Workbook();
      for (const l of lembar) {
        const sheet = book.addWorksheet(l.nama, { views: [{ state: "frozen", ySplit: 1 }] });
        sheet.addRow(l.kolom); sheet.getRow(1).font = { bold: true };
        sheet.addRows(l.baris.map(row => row.map(amankanSel)));
        l.kolom.forEach((_, index) => {
          const angka = l.angka.includes(index);
          sheet.getColumn(index + 1).width = angka ? 20 : 27;
          if (angka) sheet.getColumn(index + 1).numFmt = "#,##0.########";
        });
        if (l.baris.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: l.kolom.length } };
      }
      book.addWorksheet("Ringkasan dan filter").addRows(info.map(row => row.map(amankanSel)));
      const bytes = await book.xlsx.writeBuffer();
      return new Response(new Uint8Array(bytes), { headers: { ...headers,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
      } });
    }
    return new Response(reportCsv([], [...lembar.flatMap(l => [[l.nama], l.kolom, ...l.baris, []]), ["Ringkasan dan filter"], ...info]), { headers: { ...headers,
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}.csv"`,
    } });
  } catch (error) {
    const failure = hppReportError(error);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
}
