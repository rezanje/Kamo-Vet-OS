/* eslint-disable @typescript-eslint/no-explicit-any */
import { fungsiBelumAda } from "./laporan-struk-kasir";

/**
 * Laporan Operation & Sales: baris mentah tiap bagian dibaca lewat SATU fungsi baca-saja di database
 * (migrasi 20261212100000, hak baca sama dengan RLS). Dulu semua bacaan berhalaman 500 baris + hitungan pasti, berurutan,
 * lewat RLS per baris (±350 query untuk bulan berjalan semua cabang). Perhitungan angka tetap dikerjakan kode yang sama:
 * fungsi hanya mengembalikan baris yang sama (kolom, nilai, urutan id) yang dulu dirakit dari halaman-halaman itu.
 * Pembaca lama hanya dipakai bila fungsinya belum ada, melewati batas waktu pernyataan, atau tidak menjawab dengan objek.
 */
export const OPERASIONAL_PENJUALAN_RPC = "laporan_operasional_penjualan";

export type BagianOperasional = "dokumen" | "grooming" | "pelanggan" | "stok" | "klinik" | "nilai_stok";

export type ArgumenBagian = {
  /** Batas awal/akhir (timestamptz, string WIB persis seperti pembaca lama). */
  mulai: string;
  akhir: string;
  /** Tanggal (YYYY-MM-DD) untuk kolom bertipe date. */
  dari: string;
  sampai: string;
  cabang: string[];
  kanal?: string;
  rataRata?: boolean;
};

type Galat = { message?: string; code?: string };

/** 57014 = batas waktu pernyataan: laporan tetap harus jadi, jadi pembaca lama yang dipakai. */
function melewatiBatasWaktu(error: Galat): boolean {
  return error.code === "57014" || /statement timeout/i.test(error.message ?? "");
}

/**
 * Panggil satu bagian. Mengembalikan `null` HANYA bila fungsinya belum ada di database, melewati batas waktu, atau tidak menjawab dengan objek
 * (pemanggil memakai pembaca lama). Galat lain (izin, Admin Online, jaringan) dilempar, tidak diam-diam jatuh ke jalur lama.
 * `periksa` memastikan bentuk hasil dan hitungan barisnya lengkap; bentuk yang salah dilempar sebagai galat baca.
 */
export async function bacaBagianOperasional<T>(
  supabase: any,
  bagian: BagianOperasional,
  argumen: ArgumenBagian,
  periksa: (data: Record<string, unknown>) => T,
): Promise<T | null> {
  if (!supabase || typeof supabase.rpc !== "function") return null;
  const { data, error } = await supabase.rpc(OPERASIONAL_PENJUALAN_RPC, {
    p_bagian: bagian,
    p_mulai: argumen.mulai,
    p_akhir: argumen.akhir,
    p_dari: argumen.dari,
    p_sampai: argumen.sampai,
    p_cabang: argumen.cabang,
    p_kanal: argumen.kanal ?? "all",
    p_rata_rata: argumen.rataRata ?? false,
  }) as { data: unknown; error: Galat | null };
  if (error) {
    if (fungsiBelumAda(error, OPERASIONAL_PENJUALAN_RPC) || melewatiBatasWaktu(error)) return null;
    throw Object.assign(new Error(`Data laporan gagal dibaca: ${error.message}`), { code: error.code });
  }
  // Fungsi asli selalu mengembalikan objek jsonb. Jawaban lain (bukan objek) bukan hasil fungsi ini: pembaca lama yang dipakai.
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return periksa(data as Record<string, unknown>);
}

/** Ambil larik bernama dan cocokkan panjangnya dengan hitungan `n_*` dari database. */
export function larik<T>(data: Record<string, unknown>, nama: string, hitungan?: string): T[] {
  const nilai = data[nama];
  if (!Array.isArray(nilai)) throw new Error(`Data laporan gagal dibaca: bagian ${nama} tidak lengkap`);
  if (hitungan !== undefined && data[hitungan] !== nilai.length) throw new Error(`Data laporan gagal dibaca: hitungan ${nama} tidak cocok`);
  return nilai as T[];
}

/** Urutan id sama dengan ORDER BY id (uuid) di database: heksadesimal huruf kecil, perbandingan teks biasa. */
export function urutId<T extends { id: string }>(baris: T[]): T[] {
  return [...baris].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
