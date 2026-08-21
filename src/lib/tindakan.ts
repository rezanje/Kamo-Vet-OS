// Kategori tindakan (PRD v2.0 §6.3) + aturan mana yang wajib form persetujuan.

export const TINDAKAN_KATEGORI = [
  "Konsultasi", "Vaksinasi", "Operasi", "Grooming", "Rawat Inap", "Lab",
] as const;
export type TindakanKategori = (typeof TINDAKAN_KATEGORI)[number];

// Aturan yang berlaku kalau tabel `consent_rules` belum terbaca (mis. komponen
// klien yang tidak punya akses database). Aturan sebenarnya diatur klinik sendiri
// di layar Form Persetujuan — daftar ini cuma jaring pengaman supaya tindakan
// berisiko tidak mendadak lolos tanpa formulir.
export const WAJIB_CONSENT: TindakanKategori[] = ["Operasi", "Rawat Inap", "Vaksinasi", "Lab"];

/** Kumpulan kategori yang wajib berformulir; kosong = pakai jaring pengaman di atas. */
export type AturanConsent = Set<string> | null | undefined;

const wajibSet = (aturan: AturanConsent): Set<string> =>
  aturan && aturan.size >= 0 ? aturan : new Set<string>(WAJIB_CONSENT);

export function kategoriWajibConsent(kategori: string | null | undefined, aturan?: AturanConsent): boolean {
  return !!kategori && wajibSet(aturan).has(kategori);
}

type ItemLike = { jenis?: string | null; kategori?: string | null };

// Kategori berisiko yang ada di kunjungan ini. Baris tanpa kategori (data lama,
// sebelum fitur ini ada) sengaja dianggap tidak berisiko supaya kunjungan lama
// tidak mendadak terblokir.
export function kategoriBerisiko(items: ItemLike[], adaRawatInap = false, aturan?: AturanConsent): string[] {
  const wajib = wajibSet(aturan);
  const found = new Set<string>();
  for (const it of items) {
    if (it.jenis === "jasa" && kategoriWajibConsent(it.kategori, wajib)) found.add(it.kategori as string);
  }
  // Rawat inap tercatat di tabelnya sendiri, bukan sebagai baris jasa.
  if (adaRawatInap && wajib.has("Rawat Inap")) found.add("Rawat Inap");
  return [...found];
}

export function butuhConsent(items: ItemLike[], adaRawatInap = false, aturan?: AturanConsent): boolean {
  return kategoriBerisiko(items, adaRawatInap, aturan).length > 0;
}

// Boleh bayar kalau tidak ada tindakan berisiko, atau consent-nya sudah ditandatangani.
export function bolehBayar(
  items: ItemLike[],
  adaRawatInap: boolean,
  consents: { status: string }[],
  aturan?: AturanConsent,
): boolean {
  if (!butuhConsent(items, adaRawatInap, aturan)) return true;
  return consents.some((c) => c.status === "sudah_ttd");
}
