// Kategori tindakan (PRD v2.0 §6.3) + aturan mana yang wajib form persetujuan.

export const TINDAKAN_KATEGORI = [
  "Konsultasi", "Vaksinasi", "Operasi", "Grooming", "Rawat Inap", "Lab",
] as const;
export type TindakanKategori = (typeof TINDAKAN_KATEGORI)[number];

// Ubah daftar ini kalau klinik mau melonggarkan/mengetatkan. Satu tempat, bukan
// tersebar di halaman — supaya aturan consent tidak pernah beda antar layar.
export const WAJIB_CONSENT: TindakanKategori[] = ["Operasi", "Rawat Inap", "Vaksinasi", "Lab"];

export function kategoriWajibConsent(kategori: string | null | undefined): boolean {
  return !!kategori && (WAJIB_CONSENT as string[]).includes(kategori);
}

type ItemLike = { jenis?: string | null; kategori?: string | null };

// Kategori berisiko yang ada di kunjungan ini. Baris tanpa kategori (data lama,
// sebelum fitur ini ada) sengaja dianggap tidak berisiko supaya kunjungan lama
// tidak mendadak terblokir.
export function kategoriBerisiko(items: ItemLike[], adaRawatInap = false): string[] {
  const found = new Set<string>();
  for (const it of items) {
    if (it.jenis === "jasa" && kategoriWajibConsent(it.kategori)) found.add(it.kategori as string);
  }
  // Rawat inap tercatat di tabelnya sendiri, bukan sebagai baris jasa.
  if (adaRawatInap && (WAJIB_CONSENT as string[]).includes("Rawat Inap")) found.add("Rawat Inap");
  return [...found];
}

export function butuhConsent(items: ItemLike[], adaRawatInap = false): boolean {
  return kategoriBerisiko(items, adaRawatInap).length > 0;
}

// Boleh bayar kalau tidak ada tindakan berisiko, atau consent-nya sudah ditandatangani.
export function bolehBayar(
  items: ItemLike[],
  adaRawatInap: boolean,
  consents: { status: string }[],
): boolean {
  if (!butuhConsent(items, adaRawatInap)) return true;
  return consents.some((c) => c.status === "sudah_ttd");
}
