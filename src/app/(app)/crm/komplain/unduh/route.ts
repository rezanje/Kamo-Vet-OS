import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { KOLOM_EXCEL, bacaFilter, barisExcel, hariIniWib, tanggalPendek } from "@/lib/komplain";
import { KomplainError, muatDaftar, periksaSesiKomplain } from "@/lib/komplain-server";
import { amankanSel } from "@/lib/laporan-kategori-penjualan";
import { createClient } from "@/lib/supabase/server";

// Unduh Excel daftar komplain sesuai saringan. Isinya hanya yang boleh dilihat akun ini (RPC komplain_daftar). Maks. 5000 baris. Berisi nomor HP pelanggan.
export async function GET(request: Request) {
  const supabase = await createClient();
  const sesi = await periksaSesiKomplain(supabase);
  if (!sesi.ok) return NextResponse.json({ error: "Unduhan tidak diizinkan" }, { status: 403 });
  const filter = bacaFilter(Object.fromEntries(new URL(request.url).searchParams));
  let data;
  try { data = await muatDaftar(supabase, filter, { limit: 5000, offset: 0 }); }
  catch (e) { return NextResponse.json({ error: e instanceof KomplainError ? e.message : "Daftar belum dapat dimuat." }, { status: 500 }); }

  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Komplain", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow([...KOLOM_EXCEL]);
  sheet.getRow(1).font = { bold: true };
  for (const b of data.baris) sheet.addRow(barisExcel(b));
  [18, 14, 16, 14, 26, 10, 18, 22, 16, 16, 22, 50, 30, 24, 14, 18, 10, 10, 12, 18, 18, 40, 10].forEach((lebar, i) => { sheet.getColumn(i + 1).width = lebar; });
  sheet.getColumn(15).numFmt = "#,##0";
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: KOLOM_EXCEL.length } };
  const info: (string | number)[][] = [
    ["Komplain Pelanggan"], ["Tanggal unduh", hariIniWib()], ["Jumlah baris", data.baris.length], ["Total sesuai saringan", data.total],
    ["Rentang tanggal", filter.dari || filter.sampai ? `${tanggalPendek(filter.dari)} – ${tanggalPendek(filter.sampai)}` : "semua"], ["Status", filter.status || "semua"],
    ["Catatan", "Berisi nama dan nomor HP pelanggan (data pribadi). Komplain hanya mencatat; refund/ganti barang diproses lewat layar refund/koreksi."],
  ];
  book.addWorksheet("Keterangan").addRows(info.map(r => r.map(amankanSel)));
  const buffer = await book.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer), { headers: {
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="komplain-${hariIniWib()}.xlsx"`,
  } });
}
