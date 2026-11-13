import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { amankanSel } from "@/lib/laporan-kategori-penjualan";
import {
  daftarSlow, HALAMAN_SLOW, KONFIG_STOK, labelRiwayat, LABEL_STATUS, ringkasSlow, saring,
} from "@/lib/stok-analisis";
import { muatPilihanStok, muatRingkasStok, periksaAksesStok } from "@/lib/stok-analisis-server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const akses = await periksaAksesStok(supabase, HALAMAN_SLOW);
  if (!akses.ok) return NextResponse.json({ error: "Akses laporan tidak diizinkan" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, 120);
  const kategori = (params.get("kategori") ?? "").trim().toLocaleUpperCase("id-ID").slice(0, 80);
  let pilihan, hasil;
  try {
    pilihan = await muatPilihanStok(supabase);
    const gudang = pilihan.gudang.some((w) => w.id === params.get("gudang")) ? String(params.get("gudang")) : "";
    hasil = { ...(await muatRingkasStok(supabase, gudang)), gudang };
  } catch { return NextResponse.json({ error: "Data stok belum dapat dihitung. Coba lagi." }, { status: 500 }); }

  const rows = saring(daftarSlow(hasil.baris), { q, kategori, kategoriDari: pilihan.kategoriDari });
  const ringkas = ringkasSlow(rows);
  const namaGudang = hasil.gudang ? pilihan.gudang.find((w) => w.id === hasil.gudang)?.name ?? hasil.gudang : "Semua gudang digabung";
  const kolom = ["Kode", "Barang", "Kategori", "Satuan", "Stok", "Terjual/bulan", "Cukup untuk (bulan)", "Terakhir laku", "Nilai stok", "Modal tertahan", "Status", "Sementara"];
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Slow moving", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow(kolom);
  sheet.getRow(1).font = { bold: true };
  for (const b of rows) {
    sheet.addRow([b.kode, b.nama, pilihan.kategoriDari(b), b.satuan, b.stok, b.terjualBulan, b.coverBulan ?? "", b.terakhirLaku ?? "belum ada",
      b.nilaiStok, b.modalTertahan, LABEL_STATUS[b.status], b.sementara ? "ya" : ""].map(amankanSel));
  }
  [14, 40, 20, 10, 12, 14, 18, 14, 18, 18, 12, 11].forEach((lebar, i) => { sheet.getColumn(i + 1).width = lebar; });
  [5, 6, 7, 9, 10].forEach((n) => { sheet.getColumn(n).numFmt = "#,##0.00"; });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: kolom.length } };
  const info: (string | number)[][] = [
    ["Stok slow moving / berlebih"], ["Gudang", namaGudang], ["Kategori", kategori || "Semua"], ["Cari", q],
    ["Dasar", labelRiwayat(hasil.ctx)], ["Tanggal data", hasil.ctx.hariIni],
    ["Jumlah barang", ringkas.jumlah], ["Modal tertahan (Rp)", Math.round(ringkas.modalTertahan)],
    ["Batas berlebih (bulan)", KONFIG_STOK.berlebihBulan], ["Tidak laku (hari)", KONFIG_STOK.tidakLakuHari], ["Mati (hari)", KONFIG_STOK.matiHari],
    ["Keterangan", "Terjual/bulan = barang keluar (kasir, klinik termasuk BMHP dan racikan, faktur grosir; struk batal dan retur dikurangkan) ÷ hari × 30, satuan dasar. Cukup untuk = stok ÷ terjual/bulan. Modal tertahan = nilai stok FIFO yang tidak terpakai."],
  ];
  book.addWorksheet("Keterangan").addRows(info.map((r) => r.map(amankanSel)));
  const buffer = await book.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer), { headers: {
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="stok-slow-moving-${hasil.ctx.hariIni}.xlsx"`,
  } });
}
