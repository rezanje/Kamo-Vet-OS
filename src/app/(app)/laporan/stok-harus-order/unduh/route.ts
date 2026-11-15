import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { amankanSel } from "@/lib/laporan-kategori-penjualan";
import {
  daftarHarusOrder, HALAMAN_ORDER, KONFIG_STOK, kelompokOrder, labelRiwayat, LABEL_ALASAN, saring,
} from "@/lib/stok-analisis";
import { muatPendukungOrder, muatPilihanStok, muatRingkasStok, periksaAksesStok } from "@/lib/stok-analisis-server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const akses = await periksaAksesStok(supabase, HALAMAN_ORDER);
  if (!akses.ok) return NextResponse.json({ error: "Akses laporan tidak diizinkan" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, 120);
  const kategori = (params.get("kategori") ?? "").trim().toLocaleUpperCase("id-ID").slice(0, 80);
  let pilihan, hasil, grup, gudang = "";
  try {
    pilihan = await muatPilihanStok(supabase);
    gudang = pilihan.gudang.some((w) => w.id === params.get("gudang")) ? String(params.get("gudang")) : "";
    hasil = await muatRingkasStok(supabase, gudang);
    const kandidat = saring(hasil.baris.filter((b) => b.aktif && b.alasanOrder.length > 0 && (b.minStock > 0 || b.terjualHari > 0)), { q, kategori, kategoriDari: pilihan.kategoriDari });
    const pend = await muatPendukungOrder(supabase, kandidat);
    grup = kelompokOrder(daftarHarusOrder(kandidat, pend.satuanBeli, pend.pemasok, hasil.ctx));
  } catch { return NextResponse.json({ error: "Data stok belum dapat dihitung. Coba lagi." }, { status: 500 }); }

  const namaGudang = gudang ? pilihan.gudang.find((w) => w.id === gudang)?.name ?? gudang : "Semua gudang digabung";
  const kolom = ["Pemasok", "Kode", "Barang", "Satuan dasar", "Stok", "Minimum", "Terjual/bulan", "Cukup untuk (hari)", "Alasan", "Saran order", "Satuan beli", "Perkiraan (Rp)", "Sementara"];
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Harus order", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow(kolom);
  sheet.getRow(1).font = { bold: true };
  let jumlah = 0, nilai = 0;
  for (const g of grup) for (const r of g.rows) {
    jumlah += 1; nilai += r.nilai;
    sheet.addRow([g.supplierNama, r.kode, r.nama, r.satuan, r.stok, r.minStock, r.terjualBulan, r.coverHari === null ? "" : Math.floor(r.coverHari),
      r.alasan.map((a) => LABEL_ALASAN[a]).join(", "), r.qtyPesan, r.buyUnit ?? r.satuan, r.nilai, r.sementara ? "ya" : ""].map(amankanSel));
  }
  [26, 14, 40, 12, 12, 12, 14, 18, 26, 12, 12, 18, 11].forEach((lebar, i) => { sheet.getColumn(i + 1).width = lebar; });
  [5, 6, 7, 10, 12].forEach((n) => { sheet.getColumn(n).numFmt = "#,##0.00"; });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: kolom.length } };
  const info: (string | number)[][] = [
    ["Stok harus order"], ["Gudang", namaGudang], ["Kategori", kategori || "Semua"], ["Cari", q],
    ["Dasar", labelRiwayat(hasil.ctx)], ["Tanggal data", hasil.ctx.hariIni],
    ["Jumlah barang", jumlah], ["Perkiraan nilai pesanan (Rp)", Math.round(nilai)],
    ["Lead time (hari)", KONFIG_STOK.leadTimeHari], ["Isi sampai (hari penjualan)", KONFIG_STOK.targetCoverHari],
    ["Keterangan", "Harus order = stok sama dengan atau di bawah minimum, atau cukup kurang dari lead time. Saran order dalam satuan beli, dibulatkan ke atas dan minimum beli pemasok."],
  ];
  book.addWorksheet("Keterangan").addRows(info.map((r) => r.map(amankanSel)));
  const buffer = await book.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer), { headers: {
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="stok-harus-order-${hasil.ctx.hariIni}.xlsx"`,
  } });
}
