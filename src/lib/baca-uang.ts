// Membedakan "fitur belum terpasang" dari "pembacaan uang sedang gagal".
//
// Keduanya sama-sama muncul sebagai error dari Supabase, tetapi artinya bertolak
// belakang. Tabel yang memang belum ada (migrasi belum terpasang di lingkungan ini)
// boleh diperlakukan sebagai "belum ada fitur". Gangguan baca, izin, jaringan, atau
// relasi embed yang ambigu TIDAK boleh diperlakukan sebagai "tidak ada uang masuk":
// angka nol yang salah membuat tutup shift membukukan uang asli sebagai kas lebih.

export type BacaError = { code?: string | null; message?: string | null } | null | undefined;

/** Kode PostgREST/PostgreSQL yang benar-benar berarti tabelnya belum ada. */
const BELUM_ADA = new Set(["42P01", "PGRST205", "PGRST200"]);

export function tabelBelumAda(error: BacaError): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  if (code) return BELUM_ADA.has(code);
  return /relation .* does not exist|could not find the table/i.test(String(error.message ?? ""));
}

/** Error pembacaan uang yang harus menghentikan aksi, bukan dianggap nol. */
export function gagalBacaUang(error: BacaError): boolean {
  return !!error && !tabelBelumAda(error);
}
