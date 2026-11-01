// Transaksi kasir yang terputus di tengah jalan.
//
// Checkout menyimpan kepala struk + barisnya dulu, lalu memotong stok, membukukan
// jurnal dan memfinalkan pembayaran. Kalau gagal, checkout menghapus kepala struknya
// lagi. Tapi kalau prosesnya mati di antara dua langkah itu (database lambat/hang,
// koneksi putus, fungsi server kehabisan waktu), penghapusannya tidak pernah jalan.
// Struk itu tertinggal dengan status "pembayaran diproses" selamanya, dan penjaga
// tutup shift menolak menutup laci sampai tidak ada struk seperti itu — kasir
// terkunci tanpa jalan keluar (insiden 1 Nov 2026: tiga cabang petshop tidak bisa
// tutup shift).
//
// Kapan aman dibuang otomatis:
// - Jurnal, poin dan pembayaran hanya ditulis oleh finalisasi, jadi selama
//   payments_finalized_at kosong semuanya belum tercatat.
// - STOK belum tentu. Kasir (/kasir) dan backoffice berpromo kuantitas memotong stok
//   di dalam finalisasi atomik, tetapi backoffice biasa (/pos/transaksi) memotong stok
//   per baris SEBELUM finalisasi. Struk terputus yang sudah punya mutasi stok TIDAK
//   boleh dibuang otomatis: stoknya akan tetap berkurang tanpa dokumen dan tanpa HPP,
//   dan percobaan ulang akan memotong stok yang sama dua kali. Struk seperti itu
//   dibiarkan (penjaga tetap menahan) supaya diperbaiki manusia dengan buktinya utuh.
// - Bila mutasi stok tidak bisa dibaca, dianggap ADA (gagal-tertutup).
//
// Penghapusan lewat jalur yang sama dengan pembersihan checkout biasa — pemicu
// database hanya mengizinkan kasir pemilik struk, dan menolak struk yang jurnalnya
// sudah ada.
//
// Laci yang kasirnya tidak bisa masuk lagi dibersihkan oleh tutup paksa supervisor
// (cashier_shift_supervisor_close, migrasi 20261106030000) di dalam basis data: aturan
// yang sama (≥ 10 menit, tanpa mutasi stok, tanpa jurnal, tanpa dokumen turunan), ditolak
// utuh bila ada yang tidak memenuhi, dan struk yang dibuang dicatat di jejak tutup paksa.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/**
 * Umur minimum sebelum struk yang belum final dianggap terputus. Checkout yang
 * masih berjalan selesai dalam hitungan detik (fungsi server dibatasi ±5 menit),
 * jadi 10 menit tidak akan memotong transaksi yang sedang diproses.
 */
export const BATAS_TERPUTUS_MS = 10 * 60 * 1000;

/** Sumber mutasi stok penjualan kasir/backoffice (lib/inventory → sale_stock_out_fifo). */
export const SUMBER_STOK_PENJUALAN = ["sale", "sale-group"] as const;

export type StrukBelumFinal = {
  id: string;
  no_struk?: string | null;
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

/** Apakah struk ini sudah memotong stok? Gagal baca / tanpa nomor = dianggap sudah. */
export async function strukSudahPotongStok(supabase: AnyClient, noStruk: string | null | undefined): Promise<boolean> {
  if (!noStruk) return true;
  try {
    const { data, error } = await supabase
      .from("stock_moves").select("id")
      .eq("source_ref", noStruk)
      .in("source", [...SUMBER_STOK_PENJUALAN])
      .limit(1);
    if (error || !Array.isArray(data)) return true;
    return data.length > 0;
  } catch {
    return true;
  }
}

/**
 * Buang SATU struk bila benar-benar terputus dan belum memotong stok.
 * Tidak pernah melempar error; `true` hanya bila barisnya memang terhapus.
 */
export async function buangStrukTerputus(
  supabase: AnyClient, row: StrukBelumFinal, sekarang = Date.now(), konteks = "tutup-shift",
): Promise<boolean> {
  if (!strukTerputus(row, sekarang)) return false;
  const label = row.no_struk ?? row.id;
  try {
    if (await strukSudahPotongStok(supabase, row.no_struk)) {
      console.error(`[${konteks}] struk terputus ${label} sudah memotong stok — tidak dibuang otomatis, perlu rekonsiliasi manual`);
      return false;
    }
    const { data: hapus, error: hapusErr } = await supabase
      .from("sales").delete()
      .eq("id", row.id)
      .is("payments_finalized_at", null)
      .select("id");
    if (hapusErr) {
      console.error(`[${konteks}] struk terputus ${label} gagal dibuang:`, hapusErr.message);
      return false;
    }
    if (Array.isArray(hapus) && hapus.length > 0) {
      console.warn(`[${konteks}] struk terputus ${label} dibuang (tidak pernah final, tanpa mutasi stok)`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`[${konteks}] gagal membuang struk terputus ${label}:`, error);
    return false;
  }
}

/**
 * Buang struk terputus milik shift ini. Tidak pernah melempar error: kalau ada yang
 * gagal/tidak boleh dibuang, penjaga tutup shift di database tetap menolak seperti
 * sebelumnya. Mengembalikan id struk yang berhasil dibuang.
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
    for (const row of data as StrukBelumFinal[]) {
      if (await buangStrukTerputus(supabase, row, sekarang)) dibuang.push(row.id);
    }
    return dibuang;
  } catch (error) {
    console.error("[tutup-shift] gagal memeriksa struk terputus:", error);
    return [];
  }
}

/** Pesan penjaga database "pembayaran masih diproses" dalam bahasa kasir. */
export const PESAN_MASIH_DIPROSES =
  "Masih ada transaksi yang belum selesai diproses di shift ini. Tunggu sekitar 10 menit lalu tekan Tutup Shift lagi — "
  + "transaksi yang terputus akan dibersihkan otomatis. Kalau setelah itu masih muncul, laporkan ke tim teknis KAMO "
  + "(sebut nama cabang dan jam transaksi terakhir).";

/**
 * Versi tutup paksa. Sejak migrasi 20261106030000 tutup paksa membersihkan sendiri transaksi
 * terputus dan menolak dengan pesannya sendiri (nomor struk + langkahnya), jadi pesan penjaga
 * umum ini hanya muncul bila basis data belum memasang migrasi itu.
 */
export const PESAN_MASIH_DIPROSES_TUTUP_PAKSA =
  "Laci ini masih punya transaksi kasir yang terputus, jadi belum bisa ditutup paksa. Tunggu 10 menit lalu "
  + "tutup paksa lagi. Kalau masih muncul, minta kasir pemilik laci masuk lalu tekan Tutup Shift, atau "
  + "laporkan ke tim teknis KAMO (sebut nama cabang dan kasirnya).";

const POLA_MASIH_DIPROSES = /pembayaran masih diproses/i;

export function pesanTutupShift(message: string): string {
  return POLA_MASIH_DIPROSES.test(message) ? PESAN_MASIH_DIPROSES : message;
}

export function pesanTutupPaksa(message: string): string {
  return POLA_MASIH_DIPROSES.test(message) ? PESAN_MASIH_DIPROSES_TUTUP_PAKSA : message;
}

const MAKS_STRUK_DIBUANG = 20;

/** Nomor struk terputus yang dibuang tutup paksa, dari hasil RPC cashier_shift_supervisor_close. */
export function strukDibuangTutupPaksa(hasil: unknown): string[] {
  const daftar = (hasil as { removed_pending_sales?: unknown } | null)?.removed_pending_sales;
  if (!Array.isArray(daftar)) return [];
  return daftar.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, MAKS_STRUK_DIBUANG);
}

/**
 * Catatan sesudah tutup paksa berhasil membuang transaksi terputus. `dibuang` datang dari
 * URL, jadi dipangkas; React menampilkannya sebagai teks biasa.
 */
export function pesanStrukDibuang(dibuang: string | undefined | null): string | null {
  const nomor = (dibuang ?? "").split(",").map(x => x.trim()).filter(Boolean).slice(0, MAKS_STRUK_DIBUANG)
    .map(x => x.slice(0, 40));
  if (nomor.length === 0) return null;
  return `${nomor.length} transaksi kasir yang terputus ikut dibuang (${nomor.join(", ")}). Transaksi itu tidak pernah `
    + "tersimpan sebagai penjualan — cek ke toko apakah barang atau uangnya sudah diterima dan perlu diinput ulang.";
}
