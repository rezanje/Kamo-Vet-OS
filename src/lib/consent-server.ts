// Pembaca aturan formulir persetujuan dari database. Dipisah dari `lib/tindakan`
// yang murni supaya perhitungannya tetap bisa dites tanpa database.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type AturanBaris = { kategori: string; wajib: boolean; template_id: string | null };

/**
 * Kategori tindakan yang wajib berformulir, apa adanya dari tabel aturan.
 * Tabel kosong (mis. migrasi belum jalan) mengembalikan null supaya pemanggil
 * memakai jaring pengaman di `lib/tindakan`, bukan membolehkan semuanya lewat.
 */
export async function bacaAturanConsent(supabase: Db): Promise<Set<string> | null> {
  const { data, error } = await supabase.from("consent_rules").select("kategori, wajib");
  if (error || !data || data.length === 0) return null;
  return new Set(((data as AturanBaris[]).filter((r) => r.wajib)).map((r) => r.kategori));
}
