// Unduhan daftar Faktur Penjualan gabungan — SELURUH baris sesuai saringan,
// bukan hanya halaman yang kebetulan tampil. Kolomnya sama persis dengan layar
// supaya angka yang dipegang orang keuangan bisa dicocokkan baris per baris.
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { bolehBukaPath, type AturanTersimpan } from "@/lib/akses";
import { ListLoadError } from "@/lib/checked-list";
import { reportCsv } from "@/lib/csv-report";
import { hariIniWIB } from "@/lib/tanggal";
import { CATATAN_TOTAL, KOLOM_EKSPOR, SUMBER_LABEL, STATUS_LABEL, barisEkspor } from "@/lib/faktur-gabungan";
import { bacaFilterFaktur, bacaSemuaFakturGabungan } from "@/lib/faktur-gabungan-server";

const HALAMAN = "/penjualan/faktur";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Sesi tidak ditemukan" }, { status: 401 });
  const [{ data: profile }, { data: aturan, error: aturanError }] = await Promise.all([
    supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle(),
    supabase.from("role_modules").select("role, module_id"),
  ]);
  if (aturanError || !profile?.role || profile.is_active === false
    || !bolehBukaPath(profile.role, HALAMAN, (aturan ?? []) as AturanTersimpan)) {
    return NextResponse.json({ error: "Akses daftar faktur penjualan tidak diizinkan" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const hariIni = hariIniWIB();
  const filter = bacaFilterFaktur(Object.fromEntries(params), hariIni);

  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  let hasil;
  try {
    // Hak akses cabang ikut lewat klien pengguna ini — unduhan tidak pernah
    // melihat lebih banyak daripada layarnya.
    hasil = await bacaSemuaFakturGabungan(supabase, user.id, filter);
  } catch (gagal) {
    const pesan = gagal instanceof ListLoadError ? gagal.message
      : "Daftar faktur penjualan belum dapat diunduh lengkap. Persempit rentang tanggal lalu coba lagi.";
    return NextResponse.json({ error: pesan }, { status: 400, headers });
  }

  const data = barisEkspor(hasil.rows, hariIni);
  const metadata: (string | number)[][] = [
    ["Faktur Penjualan — semua sumber"],
    ["Dari tanggal WIB", filter.dari], ["Sampai tanggal WIB", filter.sampai],
    ["Cabang", filter.cabang || "Semua cabang yang dapat diakses"],
    ["Sumber", filter.sumber ? SUMBER_LABEL[filter.sumber] : "Semua sumber"],
    ["Status", filter.status ? STATUS_LABEL[filter.status] : "Semua status"],
    ["Pelanggan", filter.pelanggan || "Semua pelanggan"],
    ["Cari", filter.cari || "—"],
    ["Dokumen batal ikut ditampilkan", filter.batal ? "Ya" : "Tidak"],
    ["Jumlah dokumen", hasil.ringkasan.jumlah],
    ["Total penjualan (Rp)", hasil.ringkasan.total],
    ["Belum lunas (Rp)", hasil.ringkasan.totalBelum],
    ["Keterangan", CATATAN_TOTAL],
  ];
  const columns = [...KOLOM_EKSPOR];
  const filename = `faktur-penjualan-${filter.dari}-${filter.sampai}`;

  if (params.get("format") === "xlsx") {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Faktur penjualan", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.addRow(columns);
    sheet.getRow(1).font = { bold: true };
    sheet.addRows(data);
    columns.forEach((_, index) => {
      sheet.getColumn(index + 1).width = index >= 7 ? 18 : 24;
      if (index === 8) sheet.getColumn(index + 1).numFmt = '#,##0.00';
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    book.addWorksheet("Ringkasan dan filter").addRows(metadata);
    const buffer = await book.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buffer), { headers: { ...headers,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
    } });
  }

  const csv = reportCsv(columns, [...data, [], ["Ringkasan dan filter"], ...metadata]);
  return new NextResponse(csv, { headers: { ...headers,
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}.csv"`,
  } });
}
