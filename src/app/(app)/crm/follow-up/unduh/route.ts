import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { KOLOM_EXCEL, KETERANGAN_RIWAYAT, TAB_FOLLOWUP, bacaFilter } from "@/lib/marketing-followup";
import { MarketingError, barisExcelFollowUp, muatDaftarMarketing, periksaAksesMarketing } from "@/lib/marketing-followup-server";
import { amankanSel } from "@/lib/laporan-kategori-penjualan";
import { createClient } from "@/lib/supabase/server";

// Unduh Excel daftar yang sedang disaring (hanya OWNER dan ADMIN yang punya akses halamannya). Maks. 500 baris per cabang.
export async function GET(request: Request) {
  const supabase = await createClient();
  const akses = await periksaAksesMarketing(supabase);
  if (!akses.ok || !akses.bolehUnduh) return NextResponse.json({ error: "Unduhan tidak diizinkan" }, { status: 403 });
  const filter = bacaFilter(Object.fromEntries(new URL(request.url).searchParams));
  let data;
  try { data = await muatDaftarMarketing(supabase, filter, { limit: 500 }); }
  catch (e) { return NextResponse.json({ error: e instanceof MarketingError ? e.message : "Daftar belum dapat dimuat." }, { status: 500 }); }

  const tab = TAB_FOLLOWUP.find(t => t.id === filter.tab)!;
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(tab.label.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow([...KOLOM_EXCEL]);
  sheet.getRow(1).font = { bold: true };
  for (const b of data.baris) sheet.addRow(barisExcelFollowUp(b));
  [24, 24, 22, 16, 14, 12, 8, 16, 10, 40, 22, 16, 30, 18].forEach((lebar, i) => { sheet.getColumn(i + 1).width = lebar; });
  sheet.getColumn(8).numFmt = "#,##0";
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: KOLOM_EXCEL.length } };
  const info: (string | number)[][] = [
    ["Follow up pelanggan: " + tab.label], ["Tanggal data", data.hari_ini], ["Jumlah baris", data.baris.length], ["Total sesuai saringan", data.total],
    ["Status", filter.status], ["Tanpa nomor HP sah (tidak ikut)", data.tanpa_nomor],
    ["Keterangan", KETERANGAN_RIWAYAT], ["Catatan", "Berisi nomor HP pelanggan (data pribadi): jangan dibagikan di luar tim marketing."],
  ];
  book.addWorksheet("Keterangan").addRows(info.map(r => r.map(amankanSel)));
  const buffer = await book.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer), { headers: {
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="follow-up-${filter.tab}-${data.hari_ini}.xlsx"`,
  } });
}
