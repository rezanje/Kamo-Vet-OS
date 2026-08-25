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

// ─────────────────────────────────────────────────────────────────────────────
// Format nomor yang bisa diatur sendiri (S5).
//
// Sebelum ini awalan dan jumlah digit tertanam di kode, jadi mengubah "FB" jadi
// "INV-BELI" harus lewat developer. Sekarang polanya disimpan di master dan
// dibaca saat dokumen dibuat. Bawaan di file ini SAMA PERSIS dengan format lama,
// jadi selama belum diubah tidak ada nomor yang berubah bentuk.

export type FormatDokumen = {
  jenis: string;
  label: string;
  /** Awalan sebelum digit urutan. Token: {YYYY} {YY} {MM} {DD}. */
  pola: string;
  digit: number;
  kelompok: "Pembelian" | "Penjualan" | "Kasir & Klinik" | "Persediaan" | "Kas & Bank";
};

export const FORMAT_BAWAAN: FormatDokumen[] = [
  { jenis: "PO", label: "Pesanan Pembelian", pola: "PO-{YYYY}{MM}{DD}-", digit: 4, kelompok: "Pembelian" },
  { jenis: "TB", label: "Penerimaan Barang", pola: "TB.{YYYY}.{MM}.", digit: 5, kelompok: "Pembelian" },
  { jenis: "FB", label: "Faktur Pembelian", pola: "FB.{YYYY}.{MM}.", digit: 5, kelompok: "Pembelian" },
  { jenis: "UM", label: "Uang Muka Pembelian", pola: "UM.{YYYY}.{MM}.", digit: 5, kelompok: "Pembelian" },
  { jenis: "PP", label: "Perintah Pembayaran", pola: "PP.{YYYY}.{MM}.", digit: 5, kelompok: "Pembelian" },
  { jenis: "RB", label: "Retur Pembelian", pola: "RB.{YYYY}.{MM}.", digit: 5, kelompok: "Pembelian" },

  { jenis: "SQ", label: "Penawaran Penjualan", pola: "SQ.{YYYY}.{MM}.", digit: 5, kelompok: "Penjualan" },
  { jenis: "SO", label: "Pesanan Penjualan", pola: "SO.{YYYY}.{MM}.", digit: 5, kelompok: "Penjualan" },
  { jenis: "DO", label: "Pengiriman Barang", pola: "DO.{YYYY}.{MM}.", digit: 5, kelompok: "Penjualan" },
  { jenis: "FJ", label: "Faktur Penjualan (petshop)", pola: "FJ.{YYYY}.{MM}.", digit: 5, kelompok: "Penjualan" },
  { jenis: "FJK", label: "Faktur Penjualan (klinik)", pola: "FJK.{YYYY}.{MM}.", digit: 5, kelompok: "Penjualan" },
  { jenis: "FJS", label: "Faktur Selisih Opname", pola: "FJS.{YYYY}.{MM}.", digit: 5, kelompok: "Penjualan" },
  { jenis: "RC", label: "Penerimaan Penjualan", pola: "RC.{YYYY}.{MM}.", digit: 5, kelompok: "Penjualan" },
  { jenis: "UJ", label: "Uang Muka Penjualan", pola: "UJ.{YYYY}.{MM}.", digit: 5, kelompok: "Penjualan" },
  { jenis: "RJ", label: "Retur Penjualan", pola: "RJ.{YYYY}.{MM}.", digit: 5, kelompok: "Penjualan" },

  { jenis: "POS", label: "Struk Kasir", pola: "POS-{YYYY}{MM}{DD}-", digit: 4, kelompok: "Kasir & Klinik" },
  { jenis: "ONL", label: "Pesanan Online", pola: "ONL-{YYYY}{MM}{DD}-", digit: 4, kelompok: "Kasir & Klinik" },
  { jenis: "INV", label: "Tagihan Klinik", pola: "INV-{YYYY}{MM}-", digit: 4, kelompok: "Kasir & Klinik" },

  { jenis: "PRM", label: "Permintaan Barang", pola: "PRM-{YYYY}{MM}{DD}-", digit: 4, kelompok: "Persediaan" },
  { jenis: "TRM", label: "Terima Permintaan", pola: "TRM-{YY}{MM}{DD}-", digit: 3, kelompok: "Persediaan" },
  { jenis: "IT", label: "Pemindahan Barang", pola: "IT.{YYYY}.{MM}.", digit: 5, kelompok: "Persediaan" },
  { jenis: "PS", label: "Penyesuaian Persediaan", pola: "PS.{YYYY}.{MM}.", digit: 5, kelompok: "Persediaan" },
  { jenis: "PRD", label: "Perintah Produksi", pola: "PRD.{YYYY}.{MM}.", digit: 5, kelompok: "Persediaan" },
  { jenis: "OPO", label: "Perintah Stok Opname", pola: "OPO.", digit: 5, kelompok: "Persediaan" },
  { jenis: "OPR", label: "Hasil Stok Opname", pola: "OPR.", digit: 5, kelompok: "Persediaan" },

  { jenis: "KM", label: "Kas Masuk", pola: "KM.{YYYY}.{MM}.", digit: 5, kelompok: "Kas & Bank" },
  { jenis: "KK", label: "Kas Keluar", pola: "KK.{YYYY}.{MM}.", digit: 5, kelompok: "Kas & Bank" },
  { jenis: "TF", label: "Transfer Kas", pola: "TF.{YYYY}.{MM}.", digit: 5, kelompok: "Kas & Bank" },
];

const BAWAAN_PER_JENIS = new Map(FORMAT_BAWAAN.map((f) => [f.jenis, f]));

/** Isi token tanggal pada pola. `tanggal` = "YYYY-MM-DD". */
export function bangunPrefix(pola: string, tanggal: string): string {
  const [y = "", m = "", d = ""] = String(tanggal).slice(0, 10).split("-");
  return String(pola)
    .replaceAll("{YYYY}", y)
    .replaceAll("{YY}", y.slice(2))
    .replaceAll("{MM}", m)
    .replaceAll("{DD}", d);
}

export function contohNomor(pola: string, digit: number, tanggal: string): string {
  return formatNomor(bangunPrefix(pola, tanggal), 1, Math.max(1, Math.min(8, digit)));
}

/**
 * Alasan pola ditolak, atau null kalau boleh dipakai. Yang dijaga: pola tidak
 * kosong, tidak memakai token yang tidak dikenal, dan tidak mengandung karakter
 * yang bikin nomor sulit dicari (spasi, %, _ — dua terakhir dipakai pencarian LIKE).
 */
export function periksaPola(pola: string): string | null {
  const p = String(pola ?? "");
  if (!p.trim()) return "Awalan tidak boleh kosong.";
  if (p.length > 30) return "Awalan terlalu panjang (maksimal 30 karakter).";
  if (/\s/.test(p)) return "Awalan tidak boleh mengandung spasi.";
  if (/[%_]/.test(p)) return "Tanda % dan _ tidak boleh dipakai — keduanya dipakai mesin pencarian nomor.";
  const tokenTidakDikenal = p.match(/\{[^}]*\}/g)?.filter((t) => !["{YYYY}", "{YY}", "{MM}", "{DD}"].includes(t));
  if (tokenTidakDikenal?.length) return `Token ${tokenTidakDikenal[0]} tidak dikenal. Yang bisa dipakai: {YYYY}, {YY}, {MM}, {DD}.`;
  return null;
}

export function periksaDigit(digit: number): string | null {
  const d = Number(digit);
  if (!Number.isInteger(d) || d < 1 || d > 8) return "Jumlah digit harus 1 sampai 8.";
  return null;
}

/**
 * Format satu jenis dokumen: dari master kalau ada, kalau tidak dari bawaan.
 * Sengaja tidak melempar error kalau masternya belum terisi — dokumen tetap harus
 * bisa dibuat walau layar pengaturan belum pernah dibuka.
 */
export async function formatDokumen(
  supabase: AnyClient,
  jenis: string,
  tanggal: string,
): Promise<{ prefix: string; digit: number }> {
  const bawaan = BAWAAN_PER_JENIS.get(jenis);
  let pola = bawaan?.pola ?? `${jenis}.{YYYY}.{MM}.`;
  let digit = bawaan?.digit ?? 5;

  const { data } = await supabase
    .from("document_numbering").select("pola, digit").eq("jenis", jenis).maybeSingle();
  if (data?.pola && !periksaPola(String(data.pola))) {
    pola = String(data.pola);
    digit = Number(data.digit) || digit;
  }
  return { prefix: bangunPrefix(pola, tanggal), digit: Math.max(1, Math.min(8, digit)) };
}

/**
 * Nomor dokumen berikutnya untuk satu jenis — sudah memakai format dari master.
 * Menggantikan pola lama "susun awalan sendiri → cari urutan → format".
 *
 * `prefix`, `digit`, dan `seq` ikut dikembalikan karena beberapa layar butuh
 * membangun nomor cadangan sendiri saat kena tabrakan (lihat kandidatNomor).
 */
export async function nomorBerikutnya(
  supabase: AnyClient,
  jenis: string,
  tanggal: string,
  o: { table: string; column: string },
): Promise<{ nomor: string; prefix: string; digit: number; seq: number }> {
  const { prefix, digit } = await formatDokumen(supabase, jenis, tanggal);
  const seq = await urutanBerikutnya(supabase, { table: o.table, column: o.column, prefix, pad: digit });
  return { nomor: formatNomor(prefix, seq, digit), prefix, digit, seq };
}
