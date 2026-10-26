import type { SupabaseClient } from "@supabase/supabase-js";

export type CompoundProductionTrace = {
  ingredient_id: string; material_item_id: string; production_order_id: string;
  no_produksi: string; restored: boolean;
};

/** Only the approved RPC may read the private compound issue/layer linkage. */
export async function readCompoundProductionTrace(client: SupabaseClient, recipeId: string): Promise<CompoundProductionTrace[]> {
  const { data, error } = await client.rpc("read_compound_production_layer_trace", { p_recipe_id: recipeId });
  if (error || !Array.isArray(data)) throw new Error("Bukti asal produksi bahan racikan belum dapat diperiksa.");
  const rows: CompoundProductionTrace[] = [];
  const seen = new Set<string>();
  for (const value of data) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Bukti asal produksi bahan racikan tidak valid.");
    const row = value as Record<string, unknown>;
    if (typeof row.ingredient_id !== "string" || typeof row.material_item_id !== "string"
      || typeof row.production_order_id !== "string" || typeof row.no_produksi !== "string"
      || typeof row.restored !== "boolean" || !row.no_produksi.trim()) {
      throw new Error("Bukti asal produksi bahan racikan tidak valid.");
    }
    const key = `${row.ingredient_id}|${row.production_order_id}|${row.restored}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row as CompoundProductionTrace);
  }
  return rows;
}
