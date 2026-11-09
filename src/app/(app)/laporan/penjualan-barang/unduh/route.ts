import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { bolehBukaPath } from "@/lib/akses";
import { reportCsv } from "@/lib/csv-report";
import { hariIniWIB } from "@/lib/tanggal";
import { jenisLaporan } from "@/lib/laporan-penjualan-barang";
import { KOLOM_ACCURATE, amankanSel, barisAccurate, barisTabelRingkasan } from "@/lib/laporan-kategori-penjualan";
import { KANAL_SEMUA, type Kanal } from "@/lib/laporan-transaksi";
import { ambilPenjualanBarang, waktuWIB } from "../data";

function tambahRingkasanKategori(book: ExcelJS.Workbook, ringkasan: Parameters<typeof barisTabelRingkasan>[0]) {
  const sheet = book.addWorksheet("Ringkasan per kategori", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow(["Kategori", "Sub kategori", "Baris", "Kuantitas", "Total Harga"]);
  sheet.getRow(1).font = { bold: true };
  for (const baris of barisTabelRingkasan(ringkasan)) {
    const row = sheet.addRow([amankanSel(baris.kategori), amankanSel(baris.tingkat === "sub" ? baris.subKategori : ""), baris.baris, baris.qty, baris.nilai]);
    if (baris.tingkat === "kategori") row.font = { bold: true };
  }
  // Jumlah akhir hanya dari kategori (bukan sub) supaya tidak terhitung dua kali.
  sheet.addRow(["Jumlah semua kategori", "", ringkasan.totalBaris, ringkasan.totalQty, ringkasan.totalNilai]).font = { bold: true };
  [24, 26, 10, 14, 18].forEach((lebar, index) => { sheet.getColumn(index + 1).width = lebar; });
  sheet.getColumn(4).numFmt = "#,##0.00";
  sheet.getColumn(5).numFmt = "#,##0.00";
}

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
  const kanalInput = params.get("kanal") ?? "";
  const kanal: Kanal = (KANAL_SEMUA as string[]).includes(kanalInput) ? kanalInput as Kanal : "Klinik";
  const jenis = jenisLaporan(kanal, params.get("jenis"));
  const q = (params.get("q") ?? "").trim().slice(0, 120);
  const cabangId = (params.get("cabang_id") ?? "").slice(0, 80);
  const pelaksanaId = (params.get("pelaksana_id") ?? "").slice(0, 80);
  const kategori = (params.get("kategori") ?? "").trim().slice(0, 80);
  const { rows, cabangOptions, pelaksanaOptions = [], pesanError, nilaiTotal, qtyTotal, ringkasan } = await ambilPenjualanBarang({ dari, sampai, kanal, jenis, q, cabangId, pelaksanaId, ...(kategori ? { kategori } : {}) });
  if (pesanError) return NextResponse.json({ error: pesanError }, { status: 400 });

  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  const columns = ["Waktu WIB", "No. dokumen", "Sumber", "Jenis", "Cabang", "Pelanggan", "Pasien", "Barang / layanan", "Kode", "Kategori", "Sub kategori", "Pelaksana tersimpan", "Qty", "Harga", kanal === "Online" || kanal === "Grosir" ? "Diskon item" : "Potongan / pembulatan", "Nilai baris", "Status", "HPP"];
  // HPP hanya ada pada baris yang modalnya memang tercatat (BMHP klinik dan baris
  // faktur grosir yang sudah dikirim); sisanya sengaja dibiarkan kosong, bukan nol.
  const data = rows.map(row => [waktuWIB(row.waktu), row.dokumen, row.kanal, row.jenis, row.cabang, row.pelanggan, row.hewan, row.nama, row.kode, row.kategori, row.subKategori, row.pelaksana, row.qty, row.harga, row.diskon, row.nilai, row.status, row.hpp ?? ""]);
  const context = kanal === "Grosir"
    ? "Nilai baris faktur grosir = qty × harga − diskon baris (dasar DPP sebelum PPN); jumlah barisnya sama dengan DPP faktur. Faktur dihitung pada tanggal fakturnya dan ikut sejak terbit walau belum dibayar. Faktur batal, faktur yang sudah diganti faktur koreksi, faktur saldo awal, dan faktur selisih stok opname tidak ikut. HPP grosir diakui di dokumen Pengiriman; baris tanpa pengiriman dibiarkan kosong."
    : kanal === "POS"
    ? "Neto POS dibagi ke tiap barang dari total struk sebelum fee merchant, termasuk diskon nota, voucher, poin, dan pembulatan. Selisih pembulatan bisa negatif. Retur belum dialokasikan ke baris."
    : kanal === "Klinik"
      ? "Neto invoice klinik dibagi ke tiap baris setelah diskon invoice, termasuk promo, voucher, poin, dan pembulatan. Pajak dan DP tidak masuk nilai baris. Racikan dicocokkan dengan resep pada kunjungan yang sama."
      : "Nilai setelah diskon item. Diskon tingkat nota, retur, dan pajak belum dibagi ke tiap baris; total dapat berbeda dari pembayaran.";
  const metadata: (string | number)[][] = [["Rincian penjualan per barang"], ["Dari tanggal WIB", dari], ["Sampai tanggal WIB", sampai],
    ["Sumber", kanal], ["Jenis", jenis], ["Kategori", kategori || "Semua"], ["Cabang", cabangId ? `${cabangOptions.find(branch => branch.id === cabangId)?.name ?? "Tidak tersedia"} · ${cabangId}` : "Semua cabang yang dapat diakses"],
    ["Pelaksana tersimpan", pelaksanaId ? `${pelaksanaOptions.find(person => person.id === pelaksanaId)?.nama ?? "Tidak tersedia"} · ${pelaksanaId}` : "Semua pelaksana"], ["Cari", q], ["Baris penjualan", rows.length], ["Jumlah terjual", qtyTotal],
    [kanal === "POS" ? "Neto barang sebelum retur dan fee (Rp)" : kanal === "Klinik" || kanal === "Grosir" ? "Neto baris sebelum pajak (Rp)" : "Nilai setelah diskon item (Rp)", nilaiTotal], ["Keterangan", context]];
  const filename = `penjualan-barang-${dari}-${sampai}`;
  if (params.get("format") === "accurate") {
    // Susunan kolom sama dengan "Rincian Faktur Penjualan" Accurate (+ Sub kategori). Baris anak BMHP (nilai 0) tidak ikut.
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Rincian faktur penjualan", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.addRow([...KOLOM_ACCURATE]);
    sheet.getRow(1).font = { bold: true };
    sheet.addRows(rows.filter(row => !row.indukId).map(barisAccurate));
    KOLOM_ACCURATE.forEach((nama, index) => {
      const lebar = ({ "Nomor #": 20, Cabang: 16, Tanggal: 12, "Kode #": 12, "Nama Barang": 40, Kategori: 18, "Sub kategori": 22, Pelanggan: 24, "Nama Tenaga Penjual": 30 } as Record<string, number>)[nama] ?? 14;
      sheet.getColumn(index + 1).width = lebar;
      if (["Kuantitas", "@Harga", "Total Harga", "Diskon"].includes(nama)) sheet.getColumn(index + 1).numFmt = "#,##0.00";
      if (nama === "Tanggal") sheet.getColumn(index + 1).numFmt = "dd/mm/yyyy";
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: KOLOM_ACCURATE.length } };
    tambahRingkasanKategori(book, ringkasan);
    book.addWorksheet("Filter").addRows(metadata.map(row => row.map(amankanSel)));
    const buffer = await book.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buffer), { headers: { ...headers,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rincian-penjualan-kategori-${dari}-${sampai}.xlsx"`,
    } });
  }
  if (params.get("format") === "xlsx") {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Penjualan barang", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.addRow(columns);
    sheet.getRow(1).font = { bold: true };
    sheet.addRows(data.map(row => row.map(amankanSel)));
    const kolomAngka = new Set(["Qty", "Harga", "Nilai baris", "HPP", "Diskon item", "Potongan / pembulatan"]);
    columns.forEach((nama, index) => {
      const angka = kolomAngka.has(nama);
      sheet.getColumn(index + 1).width = angka ? 20 : 28;
      if (angka) sheet.getColumn(index + 1).numFmt = '#,##0.00';
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    book.addWorksheet("Ringkasan dan filter").addRows(metadata.map(row => row.map(amankanSel)));
    tambahRingkasanKategori(book, ringkasan);
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
  const ringkasanCsv = [["Kategori", "Sub kategori", "Baris", "Kuantitas", "Total Harga"],
    ...barisTabelRingkasan(ringkasan).map(baris => [baris.kategori, baris.tingkat === "sub" ? baris.subKategori : "", baris.baris, baris.qty, baris.nilai]),
    ["Jumlah semua kategori", "", ringkasan.totalBaris, ringkasan.totalQty, ringkasan.totalNilai]];
  const csv = reportCsv(columns, [...data, [], ["Ringkasan dan filter"], ...metadata, [], ["Ringkasan per kategori"], ...ringkasanCsv]);
  return new NextResponse(csv, { headers: { ...headers,
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}.csv"`,
  } });
}
