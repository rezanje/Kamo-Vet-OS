// Penomoran dokumen — SATU pintu untuk semua nomor berurutan.
//
// Sebelumnya tiap layar menghitung `count(*) + 1`. Itu benar HANYA kalau tidak ada
// satu pun dokumen yang pernah hilang. Begitu ada lubang — dokumen dibatalkan,
// dihapus, atau gagal di tengah jalan — jumlah baris jadi lebih kecil dari nomor
// terakhir, nomor baru menabrak dokumen lama, dan penyimpanan gagal terus sampai
// lubangnya tertutup sendiri. Untuk jurnal, kejadian ini mematikan seluruh
// pencatatan keuangan satu bulan (lihat docs/UJI-ALUR-LINTAS-MODUL-2026-08-04.md).
//
// Jadi: urutan berikutnya SELALU diambil dari nomor tertinggi yang sudah ada.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/**
 * Urutan yang terbaca dari sebuah nomor dokumen: `pad` digit tepat setelah `prefix`.
 * Nomor bersuffix acak (hasil penyelamatan saat tabrakan, mis. `FJ.2026.08.00007-A1B2`)
 * tetap terbaca karena yang diambil cuma bagian digitnya.
 */
export function seqDariNomor(nomor: string | null | undefined, prefix: string, pad: number): number {
  if (!nomor) return 0;
  const angka = Number(nomor.slice(prefix.length, prefix.length + pad));
  return Number.isFinite(angka) ? angka : 0;
}

export type OpsiNomor = {
  /** Tabel yang menyimpan dokumennya. */
  table: string;
  /** Kolom nomor dokumen, mis. "no_faktur". */
  column: string;
  /** Awalan sebelum digit urutan, mis. "FJ.2026.08." atau "PRM-20260804-". */
  prefix: string;
  /** Jumlah digit urutan. */
  pad: number;
};

/**
 * Urutan dokumen berikutnya = urutan tertinggi yang sudah ada + 1.
 *
 * Dua pengguna yang menyimpan bersamaan masih bisa dapat angka sama — itu tugas
 * unique constraint di database, dan pemanggil sebaiknya mencoba nomor berikutnya
 * saat kena error 23505. Yang diberantas di sini adalah kegagalan PERMANEN.
 */
export async function urutanBerikutnya(supabase: AnyClient, o: OpsiNomor): Promise<number> {
  const { data } = await supabase
    .from(o.table)
    .select(o.column)
    .like(o.column, `${o.prefix}%`)
    .order(o.column, { ascending: false })
    .limit(1);

  const terakhir = (data as Record<string, string>[] | null)?.[0]?.[o.column];
  return seqDariNomor(terakhir, o.prefix, o.pad) + 1;
}

/** "YYYY-MM" dari sebuah Date, tanpa lewat toISOString (yang menggeser bulan di UTC). */
export const ymDari = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

/** Awalan nomor bulanan pola Accurate: `AWALAN.YYYY.MM.` — dipakai TB/FB/UM/PP/RB/RJ/IT/TF/KM/KK. */
export const prefixBulanan = (awalan: string, ym: string) =>
  `${awalan}.${ym.slice(0, 4)}.${ym.slice(5, 7)}.`;

/** Suffix acak untuk nomor jalan-terakhir saat dua nomor beruntun sama-sama tertabrak. */
export const acakSuffix = () => Math.random().toString(36).slice(2, 6).toUpperCase();

/** Bentuk nomor jadi: prefix + urutan berpadding. */
export const formatNomor = (prefix: string, seq: number, pad: number) =>
  `${prefix}${String(seq).padStart(pad, "0")}`;

/**
 * Deret nomor untuk dicoba berurutan saat menyimpan: dua nomor beruntun, lalu
 * satu nomor bersuffix acak sebagai jalan terakhir. Pemanggil mencoba satu per
 * satu dan berhenti di yang berhasil.
 */
export function kandidatNomor(prefix: string, seq: number, pad: number, acak: string): string[] {
  return [
    formatNomor(prefix, seq, pad),
    formatNomor(prefix, seq + 1, pad),
    `${formatNomor(prefix, seq, pad)}-${acak}`,
  ];
}
