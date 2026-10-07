import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { bolehBukaPath } from "@/lib/akses";
import { reportCsv } from "@/lib/csv-report";
import { hariIniWIB } from "@/lib/tanggal";
import { ambilPenjualanBarang, waktuWIB } from "../data";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Sesi tidak ditemukan" }, { status: 401 });
  const [{ data: profile, error: profileError }, { data: aturan, error: aturanError }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase.from("role_modules").select("role, module_id"),
  ]);
  if (profileError || aturanError || !profile?.role || !bolehBukaPath(profile.role, "/laporan/penjualan-barang", aturan ?? [])) {
    return NextResponse.json({ error: "Akses laporan tidak diizinkan" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const hariIni = hariIniWIB();
  const dari = params.get("dari") || `${hariIni.slice(0, 8)}01`;
  const sampai = params.get("sampai") || hariIni;
  const kanalInput = params.get("kanal");
  const kanal = kanalInput === "POS" || kanalInput === "Online" ? kanalInput : "Klinik";
  const jenisInput = params.get("jenis");
  const jenis = kanal === "Klinik" && ["Obat", "Jasa", "Racikan"].includes(jenisInput ?? "") ? jenisInput! : kanal === "Klinik" ? "Racikan" : "Barang";
  const q = (params.get("q") ?? "").trim().slice(0, 120);
  const { rows, pesanError, nilaiTotal, qtyTotal } = await ambilPenjualanBarang({ dari, sampai, kanal, jenis, q });
  if (pesanError) return NextResponse.json({ error: pesanError }, { status: 400 });

  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  const columns = ["Waktu WIB", "No. dokumen", "Sumber", "Jenis", "Cabang", "Pelanggan", "Pasien", "Barang / layanan", "Qty", "Harga", "Diskon item", "Nilai baris", "Status"];
  const data = rows.map(row => [waktuWIB(row.waktu), row.dokumen, row.kanal, row.jenis, row.cabang, row.pelanggan, row.hewan, row.nama, row.qty, row.harga, row.diskon, row.nilai, row.status]);
  const context = "Nilai setelah diskon item. Diskon tingkat nota, retur kasir, dan pajak tidak dibagi ke tiap baris; total dapat berbeda dari pembayaran. Racikan dicocokkan dengan resep pada kunjungan yang sama.";
  const metadata: (string | number)[][] = [["Rincian penjualan per barang"], ["Dari tanggal WIB", dari], ["Sampai tanggal WIB", sampai],
    ["Sumber", kanal], ["Jenis", jenis], ["Cari", q], ["Baris penjualan", rows.length], ["Jumlah terjual", qtyTotal],
    ["Nilai setelah diskon item (Rp)", nilaiTotal], ["Keterangan", context]];
  const filename = `penjualan-barang-${dari}-${sampai}`;
  if (params.get("format") === "xlsx") {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Penjualan barang", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.addRow(columns);
    sheet.getRow(1).font = { bold: true };
    sheet.addRows(data);
    columns.forEach((_, index) => {
      sheet.getColumn(index + 1).width = index >= 8 && index <= 11 ? 20 : 28;
      if (index >= 8 && index <= 11) sheet.getColumn(index + 1).numFmt = '#,##0.00';
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    book.addWorksheet("Ringkasan dan filter").addRows(metadata);
    const buffer = await book.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buffer), { headers: { ...headers,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
    } });
  }
  if (params.get("format") === "print") {
    const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
    const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Rincian penjualan per barang</title>
      <style>body{font:11px Arial;color:#172033}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #ccd2dc;padding:5px;text-align:left}th{background:#f0f3f8}thead{display:table-header-group}tr{break-inside:avoid}@page{size:A3 landscape;margin:10mm}@media print{button{display:none}}</style></head><body>
      <button onclick="window.print()">Cetak / simpan PDF</button><h1>Rincian penjualan per barang</h1><p>Semua ${rows.length} baris sesuai filter</p>
      <table><tbody>${metadata.map(row => `<tr>${row.map(cell => `<td>${escape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>
      <table><thead><tr>${columns.map(column => `<th>${escape(column)}</th>`).join("")}</tr></thead><tbody>${data.map(row => `<tr>${row.map(cell => `<td>${escape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
    return new NextResponse(html, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self'",
    } });
  }
  const csv = reportCsv(columns, [...data, [], ["Ringkasan dan filter"], ...metadata]);
  return new NextResponse(csv, { headers: { ...headers,
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}.csv"`,
  } });
}
