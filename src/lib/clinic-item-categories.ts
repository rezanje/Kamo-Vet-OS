import { readCompleteList } from "./checked-list";

export type ClinicItemCategory = { id: string; name: string; parent_id?: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadClinicItemCategories(client: any): Promise<ClinicItemCategory[]> {
  return readCompleteList<ClinicItemCategory>((from, to) => client.from("item_categories")
    .select("id,name,parent_id", { count: "exact" }).order("id").range(from, to), "Kategori barang klinik");
}

/** Dedicated service/action categories keep their tabs. Obat requires inventory;
 * ingredient eligibility does not prevent an inventory SKU being sold directly. */
export function splitClinicItems<T extends { id: string; category_id?: string | null; item_type?: string | null; is_compound_material: boolean }>(
  items: T[], categories: ClinicItemCategory[], compoundIds: Set<string>,
) {
  const byId = new Map(categories.map(category => [category.id, category]));
  const categoryOf = (item: T): "Jasa" | "Tindakan" | "Obat" => {
    let id = item.category_id;
    const visited = new Set<string>();
    while (id && !visited.has(id)) {
      visited.add(id);
      const category = byId.get(id);
      const name = category?.name.trim().toUpperCase();
      if (name === "JASA") return "Jasa";
      if (name === "TINDAKAN") return "Tindakan";
      id = category?.parent_id;
    }
    return item.item_type === "Jasa" ? "Jasa" : "Obat";
  };
  const classified = items.filter(item => !compoundIds.has(item.id)).map(item => ({ item, category: categoryOf(item) }));
  return {
    jasa: classified.filter(row => row.category === "Jasa").map(row => row.item),
    tindakan: classified.filter(row => row.category === "Tindakan").map(row => row.item),
    obat: classified.filter(row => row.category === "Obat" && row.item.item_type === "Persediaan").map(row => row.item),
    racikan: items.filter(item => compoundIds.has(item.id)),
    bahan: items.filter(item => item.is_compound_material),
  };
}
