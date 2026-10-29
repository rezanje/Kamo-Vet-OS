// Faktur Penjualan grosir (B2B) sebagai kanal omzet tersendiri.
//
// Sebelum ini laporan omzet hanya membaca struk kasir/online (`sales`) dan tagihan
// klinik (`invoices`), jadi faktur grosir yang diinput di menu Penjualan → Faktur
// tidak pernah muncul di laporan penjualan mana pun.
//
// Aturan angkanya:
// - Tanggal dasar = kolom `tanggal` faktur. Kolomnya bertipe date dan diisi tanggal
//   WIB yang diketik pengguna, jadi tidak perlu digeser zona waktu seperti `created_at`.
// - Akrual: faktur berstatus "berjalan" (belum dibayar) tetap omzet pada tanggal
//   terbitnya, sama seperti tagihan klinik. Yang dipakai bukan tanggal penerimaan uang.
// - Faktur batal/void tidak dihitung. Koreksi baris faktur (migrasi 20261030120000)
//   membatalkan faktur lama lalu menerbitkan faktur pengganti yang menunjuk balik lewat
//   `replaces_invoice_id`; hanya faktur yang masih hidup yang ikut.
// - Faktur saldo awal (`opening_batch_id`) bukan penjualan periode berjalan.
// - Faktur "selisih stok" dari opname bukan penjualan ke pelanggan — lihat
//   `KATEGORI_SELISIH_STOK` di bawah.
import { subtotalBaris } from "./faktur-jual-edit";

/** Faktur otomatis dari hasil opname (selisih kurang stok yang ditanggung kepala toko). */
export const KATEGORI_SELISIH_STOK = "selisih_stok";

/** Kolom minimal yang wajib ikut diambil supaya saringan omzet di bawah bisa bekerja. */
export const SELECT_FAKTUR_GROSIR =
  "id, no_faktur, branch_id, customer_id, tanggal, dpp, ppn, total, status, kategori, voided_on, opening_batch_id, replaces_invoice_id";

export type FakturGrosirInti = {
  id: string;
  status: string | null;
  kategori: string | null;
  voided_on: string | null;
  opening_batch_id: string | null;
  replaces_invoice_id: string | null;
};

/**
 * Faktur grosir yang boleh dihitung sebagai omzet penjualan.
 *
 * Dipakai di JS, bukan di query, supaya satu aturan dipakai semua laporan dan bisa
 * diuji sekali. Faktur yang sudah diganti faktur koreksi disaring dua lapis: lewat
 * statusnya sendiri dan lewat tautan `replaces_invoice_id` faktur penggantinya.
 */
export function fakturGrosirOmzet<T extends FakturGrosirInti>(rows: T[]): T[] {
  const sudahDiganti = new Set(
    rows.map((row) => row.replaces_invoice_id).filter((id): id is string => !!id),
  );
  return rows.filter((row) =>
    (row.status ?? "").trim().toLowerCase() !== "batal"
    && !row.voided_on
    && !row.opening_batch_id
    && (row.kategori ?? "umum") !== KATEGORI_SELISIH_STOK
    && !sudahDiganti.has(row.id));
}

/**
 * Nilai dokumen untuk laporan omzet per dokumen/cabang: total faktur, yaitu DPP
 * setelah diskon baris ditambah PPN. Sama dengan perlakuan struk kasir dan tagihan
 * klinik yang juga memakai total dokumen apa adanya.
 */
export function omzetDokumenGrosir(faktur: { total: number | string | null }): number {
  return Number(faktur.total) || 0;
}

/**
 * Nilai per baris faktur: qty × harga − diskon baris, yaitu dasar DPP sebelum PPN.
 * Sejajar dengan laporan per barang klinik yang juga memakai "neto baris sebelum pajak".
 * Faktur grosir tidak punya diskon tingkat kepala faktur, jadi jumlah seluruh baris
 * selalu sama dengan DPP faktur.
 */
export function nilaiBarisGrosir(baris: { qty: number | string; harga: number | string; diskon: number | string | null }): number {
  return subtotalBaris({
    qty: Number(baris.qty) || 0,
    harga: Number(baris.harga) || 0,
    diskon: Number(baris.diskon) || 0,
  });
}

/**
 * Modal per baris faktur grosir. Barangnya keluar di dokumen Pengiriman dan di situlah
 * HPP FIFO-nya dicatat; faktur hanya menyimpan hasil alokasinya. Faktur tanpa pengiriman
 * (mis. faktur manual) tidak punya modal, jadi dikembalikan null dan ditampilkan kosong.
 */
export function hppBarisGrosir(baris: { hpp: number | string | null }): number | null {
  if (baris.hpp === null || baris.hpp === undefined || baris.hpp === "") return null;
  const nilai = Number(baris.hpp);
  return Number.isFinite(nilai) && nilai > 0 ? nilai : null;
}
