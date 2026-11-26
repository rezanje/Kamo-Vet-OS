import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { bacaSaringan, muatAkses, muatDaftar } from "@/lib/setoran-server";
import { barisExcel } from "@/lib/setoran";
import { amankanSel } from "@/lib/laporan-kategori-penjualan";
import { hariIniWIB } from "@/lib/tanggal";

// Unduh Excel rekap setoran. HANYA penyetuju (berisi selisih/kurang/lebih). Isinya diambil lewat RPC yang sama dengan layar (maks. 500 baris).
export async function GET(request: Request) {
  const supabase = await createClient();
  const akses = await muatAkses(supabase);
  if (!akses.masuk || !akses.penyetuju) return NextResponse.json({ error: "Unduhan tidak diizinkan" }, { status: 403 });
  const hari = hariIniWIB();
  const f = bacaSaringan(Object.fromEntries(new URL(request.url).searchParams), hari);
  let daftar;
  try { daftar = await muatDaftar(supabase, f); } catch { return NextResponse.json({ error: "Daftar belum dapat dimuat." }, { status: 500 }); }
  const { judul, baris } = barisExcel(daftar.baris);
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Rekap Setoran", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow(judul); sheet.getRow(1).font = { bold: true };
  for (const r of baris) sheet.addRow(r.map((c) => (typeof c === "string" ? amankanSel(c) : c)));
  [16, 22, 14, 14, 14, 12, 16, 16, 16, 16, 16, 10, 16, 12].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
  for (const c of [7, 8, 9, 10, 11]) sheet.getColumn(c).numFmt = "#,##0.00";
  const info: (string | number)[][] = [["Rekap Setoran"], ["Tanggal unduh", hari], ["Periode", `${f.dari} s/d ${f.sampai}`], ["Jumlah baris", baris.length], ["Catatan", "Berisi selisih kurang/lebih; hanya untuk Owner/Finance/Admin."]];
  book.addWorksheet("Keterangan").addRows(info.map((r) => r.map((c) => (typeof c === "string" ? amankanSel(c) : c))));
  const buffer = await book.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer), { headers: {
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="rekap-setoran-${hari}.xlsx"`,
  } });
}
