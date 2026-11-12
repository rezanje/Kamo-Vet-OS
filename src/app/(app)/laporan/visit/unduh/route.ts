// Unduhan lengkap Laporan Visit rawat inap (A4, meeting 12 Nov 2026).
// Dibentuk di server dari data & saringan yang sama dengan halaman (olah.ts).
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { bolehBukaPath } from "@/lib/akses";
import { reportCsv } from "@/lib/csv-report";
import { amankanSel } from "@/lib/laporan-kategori-penjualan";
import { LABEL_JENIS_CATATAN } from "@/lib/laporan-visit";
import { hariIniWIB } from "@/lib/tanggal";
import { ambilOpsiFilterVisit, ambilVisit } from "../data";
import { bacaPeran, olahLaporanVisit } from "../olah";

type Sel = string | number;
const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const jamWIB = (iso: string) =>
  new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Sesi tidak ditemukan" }, { status: 401 });
  const [{ data: profile, error: profileError }, { data: aturan, error: aturanError }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase.from("role_modules").select("role, module_id"),
  ]);
  if (profileError || aturanError || !profile?.role || !bolehBukaPath(profile.role, "/laporan/visit", aturan ?? [])) {
    return NextResponse.json({ error: "Akses laporan tidak diizinkan" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const hariIni = hariIniWIB();
  const dari = (params.get("dari") ?? "").slice(0, 10) || `${hariIni.slice(0, 8)}01`;
  const sampai = (params.get("sampai") ?? "").slice(0, 10) || hariIni;
  const peran = bacaPeran(params.get("peran") ?? "");
  const opsi = await ambilOpsiFilterVisit();
  const cabangDiminta = params.get("cabang_id") ?? "";
  const cabangId = opsi.cabangOptions.some((c) => c.id === cabangDiminta) ? cabangDiminta : "";
  const data = await ambilVisit({ dari, sampai, cabangId });
  if (data.pesanError) return NextResponse.json({ error: data.pesanError }, { status: 400 });
  const orang = params.get("orang") ?? "";
  const employeeId = orang && (opsi.karyawan.some((k) => k.id === orang) || data.rows.some((r) => r.dokterId === orang || r.paramedisId === orang)) ? orang : "";
  const { terpilih, rekap, total, pilihanOrang } = olahLaporanVisit(data.rows, opsi.karyawan, { cabangId, employeeId, peran });

  const filter: Sel[][] = [
    ["Laporan Visit Rawat Inap"],
    ["Dari tanggal", dari],
    ["Sampai tanggal", sampai],
    ["Cabang", cabangId ? opsi.cabangOptions.find((c) => c.id === cabangId)?.name ?? cabangId : "Semua cabang yang dapat diakses"],
    ["Peran", peran || "Dokter & paramedis"],
    ["Dokter / paramedis", employeeId ? pilihanOrang.find((p) => p.id === employeeId)?.nama ?? employeeId : "Semua orang"],
    ["Visit dokter (catatan)", total.visit],
    ["Pasien rawat inap divisit", total.pasien],
    ["Pemantauan (bukan visit)", total.pemantauan],
    ["Aturan hitung", "1 catatan Visit dokter = 1 visit untuk dokter visit dan 1 visit untuk paramedis di catatan itu. Catatan Pemantauan tidak dihitung sebagai visit. Nilai rupiah insentif belum dihitung."],
  ];
  const rekapKolom = ["Nama", "Peran", "Jumlah visit", "Pasien berbeda", "Hari visit", "Pemantauan (bukan visit)", "Keterangan"];
  const rekapBaris: Sel[][] = rekap.map((r) => [r.nama, r.peran, r.visit, r.pasien, r.hari, r.pemantauan, r.employeeId ? "" : "Data lama, tanpa ID karyawan"]);
  const rincianKolom = ["Nama", "Peran", "Tanggal", "Jam", "Jenis", "Cabang", "Pasien", "Pemilik", "Kondisi", "Tindakan"];
  const rincianBaris: Sel[][] = [...terpilih]
    .sort((a, b) => a.peran.localeCompare(b.peran) || a.nama.localeCompare(b.nama, "id")
      || a.baris.tanggal.localeCompare(b.baris.tanggal) || a.baris.waktu.localeCompare(b.baris.waktu))
    .map(({ baris, nama, peran: p }) => [nama, p, baris.tanggal, jamWIB(baris.waktu), LABEL_JENIS_CATATAN(baris.jenis),
      baris.cabang, baris.pasien, baris.pemilik, baris.kondisi, baris.tindakan]);

  const nama = `laporan-visit-${dari}-${sampai}`;
  if (params.get("format") === "csv") {
    const csv = reportCsv([], [...filter, [], ["Rekap per orang"], rekapKolom, ...rekapBaris, [], ["Rincian catatan"], rincianKolom, ...rincianBaris]);
    return new NextResponse(csv, { headers: { ...HEADERS, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nama}.csv"` } });
  }

  const book = new ExcelJS.Workbook();
  const sheetFilter = book.addWorksheet("Filter");
  sheetFilter.addRows(filter.map((row) => row.map(amankanSel)));
  sheetFilter.getColumn(1).width = 30;
  sheetFilter.getColumn(2).width = 60;
  for (const [namaSheet, kolom, baris] of [["Rekap per orang", rekapKolom, rekapBaris], ["Rincian catatan", rincianKolom, rincianBaris]] as const) {
    const sheet = book.addWorksheet(namaSheet, { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.addRow([...kolom]);
    sheet.getRow(1).font = { bold: true };
    sheet.addRows(baris.map((row) => row.map(amankanSel)));
    kolom.forEach((k, index) => { sheet.getColumn(index + 1).width = ["Kondisi", "Tindakan"].includes(k) ? 50 : 22; });
    if (baris.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: kolom.length } };
  }
  const buffer = await book.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer), { headers: { ...HEADERS,
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${nama}.xlsx"`,
  } });
}
