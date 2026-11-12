/**
 * Tanggal efektif (backdate) untuk "Batalkan penerimaan", "Terima pembayaran" ulang, dan "Batalkan pencairan" petshop (gaya Accurate).
 *
 * Tanggal efektif = tanggal pembukuan jurnal pembalik / jurnal terima ulang. Struk, baris, stok, HPP, dan jurnal penjualan TIDAK ditulis ulang;
 * laporan omzet/penjualan membaca tanggal struk (tidak berubah), sedangkan Kas/Bank, Buku Besar, Neraca, Arus Kas, dan Piutang membaca
 * tanggal jurnal (ikut tanggal efektif). Efek fisik laci tetap di shift pelaku sekarang.
 *
 * Fungsi murni. Basis data (pos_receipt_date_bounds + RPC) tetap pemutus; layar hanya pratinjau dan petunjuk.
 */
import { hariIniWIB } from "./tanggal";

export type BatasTanggal = {
  /** Tanggal terawal menurut aturan rentang (tanggal struk / jurnal yang dibalik / pembatalan terbuka). */
  min: string;
  /** Hari ini WIB. */
  max: string;
  /** Periode akuntansi ditutup sampai tanggal ini (inklusif), atau null. */
  closedUntil: string | null;
  /** Tanggal terawal yang boleh dipilih (sesudah periode tertutup). */
  effectiveMin: string;
  /** Hanya Owner (atau peran yang dicentang Owner) boleh memilih tanggal sebelum hari ini. */
  canBackdate: boolean;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** True bila teks adalah tanggal kalender nyata "YYYY-MM-DD" (bukan 2026-02-30). */
export function tanggalIsoValid(text: string): boolean {
  if (!ISO.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "2026-11-12" -> "12/11/2026". */
export function tanggalId(iso: string): string {
  if (!tanggalIsoValid(iso)) return iso;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Tanggal WIB dari stempel waktu ISO (bukan UTC): untuk membandingkan tanggal struk dan tanggal catat. */
export function tanggalWibDariWaktu(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + 7 * 3600_000).toISOString().slice(0, 10);
}

/**
 * Isian tanggal dari formulir. Kosong = tidak memilih (hari ini). Tidak valid = galat yang jelas (bukan diam-diam hari ini).
 * Tanggal di masa depan ditolak di sini dan di database.
 */
export function bacaTanggalEfektif(value: FormDataEntryValue | null, hariIni: string = hariIniWIB()): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (!tanggalIsoValid(text)) throw new Error("Tanggal efektif tidak valid. Pilih tanggal dari kalender (hari/bulan/tahun).");
  if (text > hariIni) throw new Error(`Tanggal efektif ${tanggalId(text)} belum tiba (hari ini ${tanggalId(hariIni)}). Pilih hari ini atau tanggal sebelumnya.`);
  return text;
}

/** Tanggal sebelum hari ini wajib beralasan (database menolak tanpa alasan; pesan ini mendahuluinya dengan kalimat jelas). */
export function perluAlasanTanggal(tanggal: string | null, hariIni: string = hariIniWIB()): boolean {
  return !!tanggal && tanggal < hariIni;
}

/** Jawaban RPC pos_receipt_date_bounds -> BatasTanggal; bentuk tak dikenal = null. */
export function bacaBatasTanggal(data: unknown): BatasTanggal | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && tanggalIsoValid(v) ? v : null);
  const min = s(d.min_date), max = s(d.max_date), effectiveMin = s(d.effective_min);
  if (!min || !max || !effectiveMin) return null;
  return { min, max, closedUntil: s(d.closed_until), effectiveMin, canBackdate: d.can_backdate === true };
}

/**
 * Batas cadangan bila RPC rentang tidak terbaca. Owner tidak pernah dikunci oleh layar: rentang dasar (tanggal struk .. hari ini) dibuka dan
 * database memutuskan; peran lain hanya hari ini.
 */
export function batasCadangan(tanggalStruk: string, isOwner: boolean, hariIni: string = hariIniWIB()): BatasTanggal {
  const min = isOwner && tanggalStruk && tanggalStruk <= hariIni ? tanggalStruk : hariIni;
  return { min, max: hariIni, closedUntil: null, effectiveMin: min, canBackdate: isOwner };
}

/** Batas yang dipakai kolom tanggal: min tidak pernah melewati max (periode tertutup sampai hari ini -> database yang menolak dengan jelas). */
export function batasKolom(b: BatasTanggal): { min: string; max: string } {
  return { min: b.effectiveMin <= b.max ? b.effectiveMin : b.max, max: b.max };
}

/** Kalimat ringkas untuk banner/riwayat: kosong bila tanggal efektif = tanggal catat. */
export function catatanTanggalEfektif(efektif: string | null | undefined, dicatatIso: string | null | undefined): string | null {
  if (!efektif) return null;
  const dicatat = dicatatIso ? tanggalWibDariWaktu(dicatatIso) : "";
  if (dicatat && efektif === dicatat) return null;
  return `Dibukukan di tanggal ${tanggalId(efektif)}${dicatat ? ` (dicatat ${tanggalId(dicatat)})` : ""}`;
}
