// A3 (meeting 12 Nov 2026): unduhan lengkap Penjualan per Tenaga Penjual.
//
// Dulu unduhan dibentuk di browser dari tabel yang tampil, sehingga hasilnya
// bergantung pada layar (dan dilaporkan gagal saat disaring ke satu tenaga
// penjual). Sekarang berkas dibentuk di server dari data & saringan yang SAMA
// dengan halaman (olah.ts), untuk semua kombinasi filter — termasuk Rekap per item.
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { bolehBukaPath } from "@/lib/akses";
import { reportCsv } from "@/lib/csv-report";
import { amankanSel } from "@/lib/laporan-kategori-penjualan";
import { JENIS_PENJUAL, KANAL_PENJUAL, LABEL_KANAL_PENJUAL, LABEL_PERAN } from "@/lib/laporan-tenaga-penjual";
import { hariIniWIB } from "@/lib/tanggal";
import { ambilOpsiFilterPenjual, ambilTenagaPenjual } from "../data";
import { bacaSaringan, labelPeran, olahLaporanPenjual, LABEL_TAMPILAN, type ParamPenjual } from "../olah";

type Sel = string | number;
type Lembar = { nama: string; kolom: string[]; baris: Sel[][]; angka: string[] };

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Sesi tidak ditemukan" }, { status: 401 });
  const [{ data: profile, error: profileError }, { data: aturan, error: aturanError }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase.from("role_modules").select("role, module_id"),
  ]);
  if (profileError || aturanError || !profile?.role || !bolehBukaPath(profile.role, "/laporan/penjual", aturan ?? [])) {
    return NextResponse.json({ error: "Akses laporan tidak diizinkan" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const sp: ParamPenjual = Object.fromEntries(
    ["dari", "sampai", "cabang_id", "kanal", "peran", "karyawan", "jenis", "tampilan"].map((k) => [k, (params.get(k) ?? "").slice(0, 120)]),
  );
  const hariIni = hariIniWIB();
  const dari = sp.dari || `${hariIni.slice(0, 8)}01`;
  const sampai = sp.sampai || hariIni;
  const saringan = bacaSaringan(sp);

  const opsi = await ambilOpsiFilterPenjual();
  const cabangId = opsi.cabangOptions.some((c) => c.id === sp.cabang_id) ? sp.cabang_id! : "";
  const data = await ambilTenagaPenjual({ dari, sampai, cabangId });
  if (data.pesanError) return NextResponse.json({ error: data.pesanError }, { status: 400 });
  const karyawanId = data.karyawan.some((k) => k.id === sp.karyawan) ? sp.karyawan! : "";
  const hasil = olahLaporanPenjual(data, { ...saringan, cabangId, karyawanId });
  const { labelOrang, total } = hasil;

  const filter: Sel[][] = [
    ["Penjualan per Tenaga Penjual"],
    ["Dari tanggal WIB", dari],
    ["Sampai tanggal WIB", sampai],
    ["Cabang", cabangId ? opsi.cabangOptions.find((c) => c.id === cabangId)?.name ?? cabangId : "Semua cabang yang dapat diakses"],
    ["Kanal", saringan.kanal ? LABEL_KANAL_PENJUAL[saringan.kanal] : "Semua kanal"],
    ["Peran", saringan.peran ? LABEL_PERAN[saringan.peran] : "Semua peran"],
    ["Karyawan", karyawanId ? labelOrang(karyawanId) : "Semua karyawan"],
    ["Jenis", saringan.jenis || "Semua jenis"],
    ["Tampilan di layar", LABEL_TAMPILAN[saringan.tampilan]],
    ["Tenaga penjual", hasil.orang.length],
    ["Total perusahaan (netto, tiap baris 1x)", total.netto],
    ["Keterangan", "Baris yang dikerjakan Dokter dan Non-dokter dihitung penuh untuk masing-masing orang; jumlah per orang boleh lebih besar dari total perusahaan. Tagihan klinik dihitung sejak terbit (akrual); laporan Komisi memakai tanggal pelunasan."],
  ];

  const lembar: Lembar[] = [
    {
      nama: "Rekap per orang",
      kolom: ["Tenaga penjual", "Peran", "Transaksi", "Baris", "Qty",
        ...KANAL_PENJUAL.map((k) => LABEL_KANAL_PENJUAL[k]), ...JENIS_PENJUAL, "Bruto", "Diskon", "Netto"],
      baris: [
        ...hasil.barisRekap.map((r) => [labelOrang(r.employeeId), labelPeran(r.peran), r.transaksi, r.baris, r.qty,
          ...KANAL_PENJUAL.map((k) => r.perKanal[k]), ...JENIS_PENJUAL.map((j) => r.perJenis[j]), r.bruto, r.diskon, r.netto]),
        ["Total perusahaan", "tiap baris 1x", total.transaksi, total.baris, total.qty,
          ...KANAL_PENJUAL.map((k) => total.perKanal[k]), ...JENIS_PENJUAL.map((j) => total.perJenis[j]), total.bruto, total.diskon, total.netto],
      ],
      angka: ["Transaksi", "Baris", "Qty", ...KANAL_PENJUAL.map((k) => LABEL_KANAL_PENJUAL[k]), ...JENIS_PENJUAL, "Bruto", "Diskon", "Netto"],
    },
    {
      nama: "Rekap per item",
      kolom: ["Tenaga penjual", "Peran", "Kode", "Item", "Jenis", "Satuan", "Qty bersih", "Qty retur", "Transaksi", "Netto"],
      baris: hasil.perItem.map((r) => [labelOrang(r.employeeId), labelPeran(r.peran), r.kode, r.item, r.jenis, r.satuan,
        r.qty, r.qtyRetur, r.transaksi, r.netto]),
      angka: ["Qty bersih", "Qty retur", "Transaksi", "Netto"],
    },
    {
      nama: "Rincian baris",
      kolom: ["Tenaga penjual", "Peran", "Tanggal", "Dokumen", "Kanal", "Cabang", "Pelanggan", "Pasien", "Kode", "Item", "Jenis", "Satuan", "Qty", "Bruto", "Netto"],
      baris: [...hasil.terpilih]
        .sort((a, b) => labelOrang(a.employeeId).localeCompare(labelOrang(b.employeeId), "id")
          || a.baris.waktu.localeCompare(b.baris.waktu) || a.baris.id.localeCompare(b.baris.id))
        .map(({ baris, employeeId, peran }) => [labelOrang(employeeId), peran ? LABEL_PERAN[peran] : "—", baris.tanggal, baris.dokumen,
          baris.kanal, baris.cabang, baris.pelanggan, baris.pasien, baris.kode ?? "", baris.item, baris.jenis, baris.satuan ?? "",
          baris.qty, baris.bruto, baris.netto]),
      angka: ["Qty", "Bruto", "Netto"],
    },
    {
      nama: "Faktur grosir",
      kolom: ["No. faktur", "Tanggal", "Penjual", "Nilai", "Dibayar", "Sisa"],
      baris: hasil.fakturTerpilih.map((f) => [f.no_faktur, f.tanggal, labelOrang(f.penjualId), f.nilai, f.dibayar, f.sisa]),
      angka: ["Nilai", "Dibayar", "Sisa"],
    },
  ];

  const nama = `penjualan-tenaga-penjual-${dari}-${sampai}`;
  if (params.get("format") === "csv") {
    const csv = reportCsv([], [
      ...filter, [],
      ...lembar.flatMap((l) => [[l.nama], l.kolom, ...l.baris, []]),
    ]);
    return new NextResponse(csv, { headers: { ...HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nama}.csv"`,
    } });
  }

  const book = new ExcelJS.Workbook();
  book.addWorksheet("Filter").addRows(filter.map((row) => row.map(amankanSel)));
  book.getWorksheet("Filter")!.getColumn(1).width = 34;
  book.getWorksheet("Filter")!.getColumn(2).width = 60;
  for (const l of lembar) {
    const sheet = book.addWorksheet(l.nama, { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.addRow(l.kolom);
    sheet.getRow(1).font = { bold: true };
    sheet.addRows(l.baris.map((row) => row.map(amankanSel)));
    l.kolom.forEach((kolom, index) => {
      const angka = l.angka.includes(kolom);
      sheet.getColumn(index + 1).width = angka ? 16 : kolom === "Item" ? 40 : 24;
      if (angka) sheet.getColumn(index + 1).numFmt = "#,##0.##";
    });
    if (l.baris.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: l.kolom.length } };
  }
  const buffer = await book.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer), { headers: { ...HEADERS,
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${nama}.xlsx"`,
  } });
}
