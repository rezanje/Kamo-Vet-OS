import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import {
  barisExcelBawahModal, KOLOM_BAWAH_MODAL, muatBawahModal, periksaAksesBawahModal, rentangBawahModal, totalRugi,
} from "@/lib/jual-bawah-modal-server";
import { amankanSel } from "@/lib/laporan-kategori-penjualan";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  if (!(await periksaAksesBawahModal(supabase))) return NextResponse.json({ error: "Akses laporan tidak diizinkan" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const { dari, sampai } = rentangBawahModal({ dari: params.get("dari"), sampai: params.get("sampai") });
  const cabang = (params.get("cabang") ?? "").trim();
  let baris;
  try { baris = await muatBawahModal(supabase, dari, sampai, /^[0-9a-f-]{36}$/i.test(cabang) ? cabang : ""); }
  catch { return NextResponse.json({ error: "Laporan belum dapat dimuat. Coba lagi." }, { status: 500 }); }

  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Di bawah modal", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow([...KOLOM_BAWAH_MODAL]);
  sheet.getRow(1).font = { bold: true };
  for (const b of baris) sheet.addRow(barisExcelBawahModal(b));
  [12, 20, 22, 14, 40, 8, 10, 14, 16, 14, 28, 20].forEach((lebar, i) => { sheet.getColumn(i + 1).width = lebar; });
  [8, 9, 10].forEach((n) => { sheet.getColumn(n).numFmt = "#,##0.00"; });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: KOLOM_BAWAH_MODAL.length } };
  const info: (string | number)[][] = [
    ["Penjualan di bawah modal (obral Owner)"], ["Dari", dari], ["Sampai", sampai], ["Jumlah baris", baris.length], ["Total rugi (Rp)", totalRugi(baris)],
    ["Keterangan", "Rugi = HPP FIFO baris - harga neto baris (setelah diskon baris dan alokasi diskon struk). Struk yang dibatalkan atau diubah tidak dihitung dua kali."],
  ];
  book.addWorksheet("Keterangan").addRows(info.map((r) => r.map(amankanSel)));
  const buffer = await book.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer), { headers: {
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="penjualan-di-bawah-modal-${dari}-${sampai}.xlsx"`,
  } });
}
