/**
 * Simpanan sementara di memori server (per instance), untuk data master yang
 * sama untuk SEMUA pengguna (RLS select `using (true)`), mis. katalog barang kasir.
 *
 * Latar (1 Nov 2026): tiap kali layar kasir dibuka/selesai transaksi, ±3.600 barang
 * beserta satuan, harga bertingkat, diskon golongan dan komponen paket dibaca ulang
 * (±60 permintaan). Di database kelas Micro itu membuat CPU mentok dan Supabase hang.
 *
 * - Pemanggil yang bersamaan berbagi satu Promise (tidak ada baca ganda).
 * - Gagal = tidak disimpan, pemanggil berikutnya mencoba lagi.
 * - JANGAN dipakai untuk data yang bergantung pada pengguna/cabang/RLS sempit.
 * - Nilai yang dikembalikan dibagi bersama: pemanggil tidak boleh mengubahnya.
 */
/**
 * Umur simpanan katalog master kasir. Harga di layar bisa tertinggal paling lama
 * selama ini setelah master diubah; harga & satuan saat bayar tetap dihitung ulang
 * server dari database (checkout), jadi yang tertinggal hanya tampilan.
 */
export const KATALOG_KASIR_UMUR_MS = 2 * 60_000;

const simpanan = new Map<string, { kedaluwarsa: number; nilai: Promise<unknown> }>();

export function cacheSebentar<T>(kunci: string, umurMs: number, muat: () => Promise<T>): Promise<T> {
  // Tes memakai klien tiruan yang berbeda-beda; simpanan antar-tes membuat hasilnya bocor.
  if (process.env.VITEST && !aktifDiTes) return muat();
  const sekarang = Date.now();
  const ada = simpanan.get(kunci);
  if (ada && ada.kedaluwarsa > sekarang) return ada.nilai as Promise<T>;
  const nilai = muat();
  simpanan.set(kunci, { kedaluwarsa: sekarang + umurMs, nilai });
  nilai.catch(() => {
    if (simpanan.get(kunci)?.nilai === nilai) simpanan.delete(kunci);
  });
  return nilai;
}

let aktifDiTes = false;
/** Untuk tes helper ini sendiri. */
export function aturCacheSebentarUntukTes(aktif: boolean) {
  aktifDiTes = aktif;
  simpanan.clear();
}
