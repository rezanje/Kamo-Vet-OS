import type { SupabaseClient } from "@supabase/supabase-js";
import { readCompleteList } from "@/lib/checked-list";

type Recipe = { id: string; item_id: string };
export type SkuProductionOrder = {
  id: string; no_produksi: string; recipe_id: string | null; output_item_id: string | null;
  status: string; tanggal: string; qty_jadi: number; nilai_bahan: number;
};

const batches = <T,>(rows: T[], size: number) => Array.from(
  { length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size),
);

/** Read exact output-SKU relationships and keep only orders verified by the existing POS source reader. */
export async function loadProductionSkuHistory(client: SupabaseClient, itemId: string): Promise<SkuProductionOrder[]> {
  const recipes = await readCompleteList<Recipe>((from, to) => client.from("production_recipes")
    .select("id,item_id", { count: "exact" }).eq("item_id", itemId).order("id").range(from, to), "Resep produksi SKU");
  const recipeIds = new Set(recipes.map(recipe => recipe.id));
  const rows = await readCompleteList<SkuProductionOrder>((from, to) => client.from("production_orders")
    .select("id,no_produksi,recipe_id,output_item_id,status,tanggal,qty_jadi,nilai_bahan", { count: "exact" })
    .eq("output_item_id", itemId).order("id").range(from, to), "Produksi ad hoc SKU");
  for (const ids of batches([...recipeIds], 100)) {
    rows.push(...await readCompleteList<SkuProductionOrder>((from, to) => client.from("production_orders")
      .select("id,no_produksi,recipe_id,output_item_id,status,tanggal,qty_jadi,nilai_bahan", { count: "exact" })
      .in("recipe_id", ids).order("id").range(from, to), "Produksi resep SKU"));
  }
  const byId = new Map<string, SkuProductionOrder>();
  for (const row of rows) {
    if (!(row.output_item_id === itemId || (row.output_item_id === null && row.recipe_id && recipeIds.has(row.recipe_id)))) {
      throw new Error("Relasi hasil produksi tidak sesuai SKU yang dibuka.");
    }
    if (byId.has(row.id)) throw new Error("Dokumen produksi duplikat; riwayat belum dapat ditampilkan.");
    byId.set(row.id, row);
  }
  const verified: SkuProductionOrder[] = [];
  for (const group of batches([...byId.values()], 100)) {
    const { data, error } = await client.rpc("read_production_atomic_sources", { p_order_ids: group.map(row => row.id) });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) throw new Error("Bukti sumber produksi belum dapat diperiksa.");
    for (const row of group) {
      const proof = (data as Record<string, unknown>)[row.id];
      if (proof && typeof proof === "object" && !Array.isArray(proof)) verified.push(row);
    }
  }
  return verified.sort((a, b) => b.tanggal.localeCompare(a.tanggal) || b.no_produksi.localeCompare(a.no_produksi));
}
