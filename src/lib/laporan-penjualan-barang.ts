export type JenisBarisPenjualan = "Barang" | "Obat" | "Jasa" | "Racikan" | "Biaya Admin";
/** Every posted line of each clinic invoice, so a mixed invoice can be read whole and reconciled to its total. */
export const SEMUA_JENIS_KLINIK = "Semua";
const JENIS_KLINIK = [SEMUA_JENIS_KLINIK, "Obat", "Jasa", "Racikan", "Biaya Admin"];

export function jenisLaporan(kanal: string, input: string | null | undefined): string {
  if (kanal !== "Klinik") return "Barang";
  return JENIS_KLINIK.includes(input ?? "") ? input! : "Racikan";
}

export function kunciRacikan(visitId: string, nama: string): string {
  return `${visitId}::${nama.trim().toLocaleLowerCase("id-ID").replace(/\s+/g, " ")}`;
}

/**
 * Hanya baris ini yang perlu dicocokkan dengan nama resep racikan kunjungannya (tanpa tautan racikan, bukan jasa,
 * tanpa barang): baris lain sudah pasti Racikan/Jasa/Obat. Pemuat laporan hanya membaca resep untuk kunjungan baris ini.
 */
export function perluCocokNamaRacikan(baris: { jenis: string | null; item_id: string | null; compound_recipe_id?: string | null }): boolean {
  return !baris.compound_recipe_id && baris.jenis !== "jasa" && !baris.item_id;
}

export function jenisBarisKlinik(
  baris: { jenis: string | null; item_id: string | null; compound_recipe_id?: string | null; deskripsi: string },
  visitId: string,
  racikan: ReadonlySet<string>,
): JenisBarisPenjualan {
  if (baris.compound_recipe_id) return "Racikan";
  if (baris.jenis === "jasa") return "Jasa";
  if (perluCocokNamaRacikan(baris) && racikan.has(kunciRacikan(visitId, baris.deskripsi))) return "Racikan";
  return "Obat";
}
