// Pelanggan nonaktif (Aldi, 5 Nov 2026): kasir cabang memakai pelanggan "CS pusat" sebagai
// tempat "membuang" penjualan. Pelanggan nonaktif tidak boleh dipakai untuk transaksi BARU;
// riwayat, laporan, dan piutangnya tetap utuh.
//
// Penjaga utamanya di database (migrasi 20261107100000_pelanggan_nonaktif): insert struk,
// kunjungan, penawaran, pesanan, faktur, dan uang muka atas pelanggan nonaktif ditolak.
// Fungsi di sini hanya membuat pesan di layar lebih cepat & lebih jelas.

/** Pesan yang sama persis dengan penolakan database. */
export const PESAN_PELANGGAN_NONAKTIF = "Pelanggan ini sudah dinonaktifkan, pilih pelanggan asli.";

type Db = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> };
    };
  };
};

/**
 * Cek sebelum menyimpan transaksi baru. Mengembalikan pesan penolakan, atau null bila boleh
 * (tanpa pelanggan = umum, atau pelanggan aktif). Gagal membaca tidak menahan transaksi —
 * database tetap menolak pelanggan nonaktif.
 */
export async function tolakPelangganNonaktif(supabase: unknown, customerId: string | null | undefined): Promise<string | null> {
  if (!customerId) return null;
  const { data } = await (supabase as Db).from("customers").select("is_active").eq("id", customerId).maybeSingle();
  return (data as { is_active?: boolean } | null)?.is_active === false ? PESAN_PELANGGAN_NONAKTIF : null;
}
