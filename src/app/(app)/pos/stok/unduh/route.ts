// Unduhan Stok per Gudang — SELURUH barang sesuai saringan (bukan hanya halaman
// yang tampil). Mode "Semua gudang" menghasilkan matrix barang × gudang; mode
// satu gudang menghasilkan daftar stok gudang itu. Di Excel, baris judul serta
// kolom Kode dan Nama dibekukan supaya nama barang tetap terlihat saat digeser.
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { bolehBukaPath } from "@/lib/akses";
import { aturanEfektif, bacaAkses } from "@/lib/akses-akun";
import { ListLoadError } from "@/lib/checked-list";
import { reportCsv } from "@/lib/csv-report";
import { amankanSel } from "@/lib/laporan-kategori-penjualan";
import { hariIniWIB } from "@/lib/tanggal";
import { bacaGudangAktif, bacaMatrixStok, bacaSemuaStokGudang } from "@/lib/stok-gudang-server";

const HALAMAN = "/pos/stok";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Sesi tidak ditemukan" }, { status: 401 });
  const [{ data: profile }, akses] = await Promise.all([
    supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle(),
    bacaAkses(supabase),
  ]);
  if (akses.rulesError || !profile?.role || profile.is_active === false
    || !bolehBukaPath(profile.role, HALAMAN, aturanEfektif(profile.role, akses))) {
    return NextResponse.json({ error: "Akses Stok per Gudang tidak diizinkan" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const wh = params.get("wh") ?? "all";
  const cari = (params.get("q") ?? "").trim();
  const hariIni = hariIniWIB();
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

  let judul: string;
  let kolom: string[];
  let data: (string | number)[][];
  let namaFile: string;
  let kolomAngkaMulai: number;
  try {
    if (wh === "all") {
      const matrix = await bacaMatrixStok(supabase, cari);
      judul = "Stok per Gudang — semua gudang";
      kolom = ["Kode", "Nama", "Satuan", ...matrix.gudang, "Total"];
      data = matrix.items.map((r) => [r.code, r.name, r.unit, ...matrix.gudang.map((g) => r.per[g] ?? 0), r.total]);
      namaFile = `stok-per-gudang-semua-${hariIni}`;
      kolomAngkaMulai = 4;
    } else {
      const gudang = (await bacaGudangAktif(supabase)).find((g) => g.id === wh);
      if (!gudang) return NextResponse.json({ error: "Gudang tidak ditemukan atau tidak aktif" }, { status: 404, headers });
      const baris = await bacaSemuaStokGudang(supabase, gudang.id, cari);
      judul = `Stok gudang ${gudang.name} · ${gudang.code}`;
      kolom = ["Kode", "Nama", "Satuan", "Qty"];
      data = baris.map((b) => [b.code, b.name, b.unit, b.qty]);
      namaFile = `stok-gudang-${gudang.code.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${hariIni}`;
      kolomAngkaMulai = 4;
    }
  } catch (gagal) {
    const pesan = gagal instanceof ListLoadError ? gagal.message : "Stok belum dapat diunduh. Coba lagi.";
    return NextResponse.json({ error: pesan }, { status: 400, headers });
  }

  data = data.map((row) => row.map((sel) => amankanSel(sel)));
  const metadata: (string | number)[][] = [
    [judul], ["Tanggal unduh (WIB)", hariIni], ["Cari", cari || "—"], ["Jumlah barang", data.length],
  ];

  if (params.get("format") === "csv") {
    const csv = reportCsv(kolom, [...data, [], ...metadata]);
    return new NextResponse(csv, { headers: { ...headers,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${namaFile}.csv"`,
    } });
  }

  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Stok", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  sheet.addRow(kolom);
  sheet.getRow(1).font = { bold: true };
  sheet.addRows(data);
  sheet.getColumn(1).width = 20;
  sheet.getColumn(2).width = 42;
  sheet.getColumn(3).width = 10;
  for (let i = kolomAngkaMulai; i <= kolom.length; i++) {
    sheet.getColumn(i).width = Math.max(10, kolom[i - 1].length + 2);
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: kolom.length } };
  book.addWorksheet("Keterangan").addRows(metadata.map((r) => r.map((sel) => amankanSel(sel))));
  const buffer = await book.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer), { headers: { ...headers,
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${namaFile}.xlsx"`,
  } });
}
