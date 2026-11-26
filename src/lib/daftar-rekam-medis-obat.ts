/**
 * Filter "Obat / produk diberikan" di daftar Rekam Medis (parameter p_obat RPC `daftar_rekam_medis_halaman`).
 *
 * Aturan yang SAMA dengan RPC (migrasi 20261213100000), supaya pesan galat ramah muncul sebelum memanggil database:
 *   - koma memisahkan PRODUK: kunjungan harus punya SEMUA produk yang disebut;
 *   - spasi di dalam satu produk: semua kata harus ada pada nama produk yang sama (urutan bebas);
 *   - huruf besar/kecil dan aksen tidak berpengaruh; % dan _ biasa (bukan wildcard);
 *   - panjang total maksimal 100 huruf, tiap produk minimal 2 huruf, maksimal 5 produk.
 */
export const MAKS_CARI_OBAT = 100;
export const MAKS_ISTILAH_OBAT = 5;
export const MIN_HURUF_OBAT = 2;
/** Nama fungsi database yang membawa p_obat (dipakai untuk mengenali "fungsi belum ada"). */
export const RPC_DAFTAR_REKAM_MEDIS = "daftar_rekam_medis_halaman";

export const BANTUAN_CARI_OBAT =
  "Contoh: RC Recovery. Beberapa produk dipisah koma (semua harus ada pada kunjungan yang sama). Huruf besar/kecil dan aksen tidak berpengaruh. Minimal 2 huruf.";
export const BATASAN_CARI_OBAT =
  "Dicari: resep rekam medis (nama produk) dan produk yang ditagihkan kasir pada kunjungan itu. Isi racikan belum dicari (hanya nama racikannya). Baris resep yang ditarik dari rekam medis tidak ikut.";
export const PESAN_OBAT_TERLALU_PANJANG = `Kata cari obat terlalu panjang (maksimal ${MAKS_CARI_OBAT} huruf).`;
export const PESAN_OBAT_TERLALU_PENDEK = `Setiap nama obat/produk minimal ${MIN_HURUF_OBAT} huruf.`;
export const PESAN_OBAT_TERLALU_BANYAK = `Maksimal ${MAKS_ISTILAH_OBAT} obat/produk per pencarian (pisahkan dengan koma).`;
export const PESAN_OBAT_BELUM_TERSEDIA =
  "Pencarian obat belum tersedia (pembaruan database belum terpasang). Daftar di bawah TIDAK disaring menurut obat dan sengaja dikosongkan; hapus filter obat atau coba lagi nanti.";

/** Normalisasi sama dengan RPC: huruf kecil, tanpa aksen, spasi tunggal. */
export function normalisasiObat(teks: string): string {
  return teks.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

export type HasilPeriksaObat =
  | { ok: true; aktif: false }
  | { ok: true; aktif: true; teks: string; istilah: string[] }
  | { ok: false; pesan: string };

/** Periksa teks p_obat; `aktif:false` bila kosong / hanya spasi dan koma (tanpa filter). */
export function periksaCariObat(mentah: string | null | undefined): HasilPeriksaObat {
  const teks = (mentah ?? "").trim();
  if (!teks) return { ok: true, aktif: false };
  if (teks.length > MAKS_CARI_OBAT) return { ok: false, pesan: PESAN_OBAT_TERLALU_PANJANG };
  const istilah = teks.split(",").map(normalisasiObat).filter(Boolean);
  if (!istilah.length) return { ok: true, aktif: false };
  if (istilah.length > MAKS_ISTILAH_OBAT) return { ok: false, pesan: PESAN_OBAT_TERLALU_BANYAK };
  if (istilah.some((i) => i.length < MIN_HURUF_OBAT)) return { ok: false, pesan: PESAN_OBAT_TERLALU_PENDEK };
  return { ok: true, aktif: true, teks, istilah };
}

export type SumberObat = "resep" | "racikan" | "tagihan";
export type ObatCocok = { nama: string; qty: number; sumber: SumberObat };

const SUMBER_SAH = new Set<string>(["resep", "racikan", "tagihan"]);

/** Baca keping `obat_cocok` dari baris RPC; entri yang bentuknya salah dibuang (tampilan saja, tidak memengaruhi daftar). */
export function bacaObatCocok(mentah: unknown): ObatCocok[] {
  if (!Array.isArray(mentah)) return [];
  const hasil: ObatCocok[] = [];
  for (const e of mentah as { nama?: unknown; qty?: unknown; sumber?: unknown }[]) {
    if (!e || typeof e !== "object" || typeof e.nama !== "string" || !e.nama) continue;
    if (typeof e.qty !== "number" || !Number.isFinite(e.qty)) continue;
    if (typeof e.sumber !== "string" || !SUMBER_SAH.has(e.sumber)) continue;
    hasil.push({ nama: e.nama, qty: e.qty, sumber: e.sumber as SumberObat });
  }
  return hasil;
}

/** Gabungkan keping beberapa kunjungan (per pasien): jumlah qty per (sumber, nama). */
export function gabungObatCocok(daftar: ObatCocok[][]): ObatCocok[] {
  const peta = new Map<string, ObatCocok>();
  for (const satu of daftar) {
    for (const o of satu) {
      const kunci = `${o.sumber}|${o.nama}`;
      const ada = peta.get(kunci);
      if (ada) ada.qty += o.qty; else peta.set(kunci, { ...o });
    }
  }
  return [...peta.values()].sort((a, b) => (a.nama < b.nama ? -1 : a.nama > b.nama ? 1 : a.sumber < b.sumber ? -1 : a.sumber > b.sumber ? 1 : 0));
}

const LABEL_SUMBER: Record<SumberObat, string> = { resep: "", racikan: " (racikan)", tagihan: " (ditagihkan kasir)" };

/** Teks satu keping: "Icare Can Recovery ×2" (+ keterangan sumber bila bukan resep biasa). */
export function teksObatCocok(o: ObatCocok): string {
  return `${o.nama} ×${Number.isInteger(o.qty) ? o.qty : o.qty.toLocaleString("id-ID")}${LABEL_SUMBER[o.sumber]}`;
}

/** Galat PostgREST "fungsi/tanda tangan tidak ada" untuk RPC daftar (DB belum menerima p_obat). */
export function fungsiObatBelumAda(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (error.code === "PGRST202" || error.code === "42883") && (error.message ?? "").includes(RPC_DAFTAR_REKAM_MEDIS);
}
