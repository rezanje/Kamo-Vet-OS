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

export function jenisBarisKlinik(
  baris: { jenis: string | null; item_id: string | null; compound_recipe_id?: string | null; deskripsi: string },
  visitId: string,
  racikan: ReadonlySet<string>,
): JenisBarisPenjualan {
  if (baris.compound_recipe_id) return "Racikan";
  if (baris.jenis === "jasa") return "Jasa";
  if (!baris.item_id && racikan.has(kunciRacikan(visitId, baris.deskripsi))) return "Racikan";
  return "Obat";
}
