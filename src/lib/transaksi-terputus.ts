// Transaksi kasir yang terputus di tengah jalan.
//
// Checkout kasir menyimpan kepala struk + barisnya dulu, lalu satu fungsi database
// memotong stok, membukukan jurnal dan memfinalkan pembayaran SEKALIGUS (atomik).
// Kalau gagal, checkout menghapus kepala struknya lagi. Tapi kalau prosesnya mati
// di antara dua langkah itu (database lambat/hang, koneksi putus, fungsi server
// kehabisan waktu), penghapusannya tidak pernah jalan. Struk itu tertinggal dengan
// status "pembayaran diproses" selamanya, dan penjaga tutup shift menolak menutup
// laci sampai tidak ada struk seperti itu — kasir terkunci tanpa jalan keluar
// (insiden 1 Nov 2026: tiga cabang petshop tidak bisa tutup shift).
//
// Struk seperti itu aman dibuang: finalisasi bersifat atomik, jadi selama
// payments_finalized_at masih kosong belum ada stok keluar, jurnal, poin, maupun
// pembayaran yang tercatat. Penghapusan tetap lewat jalur yang sama dengan
// pembersihan checkout biasa — pemicu database hanya mengizinkan kasir pemilik
// struk, dan menolak struk yang jurnalnya sudah ada.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/**
 * Umur minimum sebelum struk yang belum final dianggap terputus. Checkout yang
 * masih berjalan selesai dalam hitungan detik (fungsi server dibatasi ±5 menit),
 * jadi 10 menit tidak akan memotong transaksi yang sedang diproses.
 */
export const BATAS_TERPUTUS_MS = 10 * 60 * 1000;

export type StrukBelumFinal = {
  id: string;
  created_at?: string | null;
  payment_plan?: unknown;
  payments_finalized_at?: string | null;
};

/** Struk berencana-bayar yang belum final dan sudah cukup lama untuk dianggap terputus. */
export function strukTerputus(row: StrukBelumFinal, sekarang = Date.now()): boolean {
  if (row.payment_plan == null || row.payments_finalized_at) return false;
  const dibuat = row.created_at ? Date.parse(row.created_at) : Number.NaN;
  if (!Number.isFinite(dibuat)) return false;
  return sekarang - dibuat >= BATAS_TERPUTUS_MS;
}

/**
 * Buang struk terputus milik shift ini. Tidak pernah melempar error: kalau ada yang
 * gagal dibuang, penjaga tutup shift di database tetap menolak seperti sebelumnya.
 * Mengembalikan id struk yang berhasil dibuang.
 */
export async function buangTransaksiTerputus(
  supabase: AnyClient, shiftId: string, sekarang = Date.now(),
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("sales")
      .select("id, no_struk, created_at, payment_plan, payments_finalized_at")
      .eq("shift_id", shiftId)
      .not("payment_plan", "is", null)
      .is("payments_finalized_at", null);
    if (error || !Array.isArray(data)) return [];
    const dibuang: string[] = [];
    for (const row of data as (StrukBelumFinal & { no_struk?: string | null })[]) {
      if (!strukTerputus(row, sekarang)) continue;
      const { data: hapus, error: hapusErr } = await supabase
        .from("sales").delete()
        .eq("id", row.id)
        .is("payments_finalized_at", null)
        .select("id");
      if (hapusErr) {
        console.error(`[tutup-shift] struk terputus ${row.no_struk ?? row.id} gagal dibuang:`, hapusErr.message);
        continue;
      }
      if (Array.isArray(hapus) && hapus.length > 0) {
        console.warn(`[tutup-shift] struk terputus ${row.no_struk ?? row.id} dibuang (tidak pernah final)`);
        dibuang.push(row.id);
      }
    }
    return dibuang;
  } catch (error) {
    console.error("[tutup-shift] gagal memeriksa struk terputus:", error);
    return [];
  }
}

/** Pesan penjaga database "pembayaran masih diproses" dalam bahasa kasir. */
export const PESAN_MASIH_DIPROSES =
  "Masih ada transaksi yang sedang diproses di shift ini. Tunggu sekitar 10 menit lalu tekan Tutup Shift lagi — "
  + "transaksi yang terputus akan dibersihkan otomatis. Kalau masih muncul, hubungi Owner/Admin.";

export function pesanTutupShift(message: string): string {
  return /pembayaran masih diproses/i.test(message) ? PESAN_MASIH_DIPROSES : message;
}
