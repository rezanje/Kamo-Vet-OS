// Gerbang laporan (meeting 12 Nov 2026, A1).
//
// Semua laporan di Daftar Laporan dibuka dalam keadaan KOSONG: filter tampil,
// tetapi query berat baru jalan setelah pengguna menekan "Tampilkan". Penanda
// yang dipakai adalah `tampil=1` di URL — disisipkan otomatis oleh form filter
// laporan (lihat `InputTampil`), dan ikut di tautan drill-down yang memang
// harus langsung menampilkan data (lihat `denganTampil`).

export const PARAM_TAMPIL = "tampil";

type ParamSumber =
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | null
  | undefined;

/** True hanya bila pengguna sudah menekan Tampilkan (URL membawa `tampil=1`). */
export function laporanDiminta(sp: ParamSumber): boolean {
  if (!sp) return false;
  const nilai = sp instanceof URLSearchParams ? sp.getAll(PARAM_TAMPIL) : [sp[PARAM_TAMPIL]].flat();
  return nilai.includes("1");
}

/**
 * Tambahkan `tampil=1` ke tautan laporan supaya halaman tujuan langsung menarik data.
 * Query lain dibiarkan PERSIS apa adanya (tidak di-encode ulang) — pesan sukses/galat
 * yang sudah di-encode tidak berubah bentuk.
 */
export function denganTampil(href: string): string {
  const hashAt = href.indexOf("#");
  const hash = hashAt >= 0 ? href.slice(hashAt) : "";
  const pathQuery = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const queryAt = pathQuery.indexOf("?");
  const query = queryAt >= 0 ? pathQuery.slice(queryAt + 1) : "";
  if (laporanDiminta(new URLSearchParams(query))) return href;
  const sambung = queryAt < 0 ? "?" : query === "" || query.endsWith("&") ? "" : "&";
  return `${pathQuery}${sambung}${PARAM_TAMPIL}=1${hash}`;
}
