export type JenisBarisPenjualan = "Barang" | "Obat" | "Jasa" | "Racikan" | "Biaya Admin";

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
