// Aturan racik obat (Addendum §2) — pure, dipakai server action + UI.

export type RecipeStatus = "pending" | "ready" | "handed_over" | "void";

export const DOSAGE_FORMS = ["sirup", "nebul", "salep", "puyer", "kapsul", "lainnya"] as const;

// §2 edge case: resep berubah setelah diproses → block edit, wajib void + buat baru.
export function canEditRecipe(status: RecipeStatus): boolean {
  return status === "pending";
}

export function nextStatus(s: RecipeStatus): RecipeStatus | null {
  return s === "pending" ? "ready" : s === "ready" ? "handed_over" : null;
}

// Baris pengurangan stok bahan (bukan obat jadi) — agregasi per item, skip bahan non-inventory.
export function stockDeductions(ings: { item_id: string | null; quantity: number }[]): { item_id: string; qty: number }[] {
  const map = new Map<string, number>();
  for (const i of ings) {
    if (!i.item_id) continue;
    map.set(i.item_id, (map.get(i.item_id) ?? 0) + Number(i.quantity));
  }
  return [...map.entries()].map(([item_id, qty]) => ({ item_id, qty }));
}
