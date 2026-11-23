/**
 * Tanggal mundur untuk input pengeluaran (keputusan Owner / Andri 23 Nov 2026: semua akun yang boleh input pengeluaran).
 * Aturan sama dengan database (migrasi *_backdate_pengeluaran): sebelum hari ini WIB wajib beralasan 3-200 huruf, paling lama 31 hari,
 * tidak boleh masa depan. Database tetap pemutus akhir; modul ini hanya memberi pesan jelas sebelum permintaan dikirim.
 */
export const BATAS_HARI_MUNDUR = 31;
export const ALASAN_MIN = 3;
export const ALASAN_MAX = 200;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function nilaiHari(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Tanggal ISO yang sah (bukan 2026-02-31). */
export function tanggalSah(iso: string): boolean {
  if (!ISO.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function geserTanggalISO(iso: string, hari: number): string {
  return new Date((nilaiHari(iso) + hari) * 86_400_000).toISOString().slice(0, 10);
}

/** Tanggal paling awal yang boleh dipilih (hari ini - 31). */
export function batasTanggalMundur(today: string): string {
  return geserTanggalISO(today, -BATAS_HARI_MUNDUR);
}

export function formatTanggalID(iso: string): string {
  if (!ISO.test(iso)) return iso;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export type CekTanggalMundur =
  | { ok: true; tanggal: string; mundur: false; alasan: null }
  | { ok: true; tanggal: string; mundur: true; alasan: string }
  | { ok: false; message: string };

/** Validasi sisi server aplikasi. `tanggal` kosong = hari ini. */
export function cekTanggalMundur(input: { tanggal: string | null | undefined; alasan: string | null | undefined; today: string }): CekTanggalMundur {
  const tanggal = (input.tanggal ?? "").trim() || input.today;
  if (!tanggalSah(tanggal)) return { ok: false, message: "Tanggal pengeluaran tidak valid." };
  if (tanggal === input.today) return { ok: true, tanggal, mundur: false, alasan: null };
  if (tanggal > input.today) return { ok: false, message: "Tanggal pengeluaran tidak boleh di masa depan. Pengeluaran ini BELUM tersimpan." };
  const alasan = (input.alasan ?? "").trim();
  if (alasan.length < ALASAN_MIN || alasan.length > ALASAN_MAX) {
    return { ok: false, message: `Tanggal mundur wajib disertai alasan ${ALASAN_MIN}-${ALASAN_MAX} huruf (mis. "nota terlupa diinput kemarin"). Pengeluaran ini BELUM tersimpan.` };
  }
  if (nilaiHari(input.today) - nilaiHari(tanggal) > BATAS_HARI_MUNDUR) {
    return { ok: false, message: `Tanggal mundur paling lama ${BATAS_HARI_MUNDUR} hari ke belakang (sampai ${formatTanggalID(batasTanggalMundur(input.today))}). Pengeluaran ini BELUM tersimpan.` };
  }
  return { ok: true, tanggal, mundur: true, alasan };
}

export function pesanDicatatDi(tanggal: string, today: string): string {
  return `Pengeluaran ini dicatat di tanggal ${formatTanggalID(tanggal)} (diinput ${formatTanggalID(today)}).`;
}

/** Penolakan pasti dari database untuk tanggal mundur: dikembalikan (bukan dilempar) agar pesannya terbaca di produksi. */
export function penolakanTanggalMundurDB(message: string | undefined, mundur: boolean): string | null {
  const m = (message ?? "").trim();
  if (m.startsWith("Tanggal mundur")) return `${m} Pengeluaran ini BELUM tersimpan.`;
  if (mundur && m.startsWith("Periode akuntansi sudah ditutup")) {
    return "Periode akuntansi untuk tanggal itu sudah ditutup. Pilih tanggal sesudah penutupan buku atau minta Finance membuka periodenya. Pengeluaran ini BELUM tersimpan.";
  }
  return null;
}
