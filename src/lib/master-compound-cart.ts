import type { RacikanIngredient } from "./racikan";
export type CompoundDraft = { saleItemId: string; formulaId: string; dosageForm: string; instruction: string; ingredients: RacikanIngredient[] };
export type CompoundSaleSku = { id: string; name: string; unit: string; sell_price: number; stok: number; code?: string | null };
export type CompoundFormula = { version_id: string; name: string; dosage_form: string; dosage_instruction: string | null; ingredients: { item_id: string; name: string; quantity: number; unit: string; unit_price: number }[] };
export function masterCompoundCartRow(sku: CompoundSaleSku | null, formula: CompoundFormula | null, draft: CompoundDraft, key: string, allowCustom: boolean) {
  if (!sku || sku.id !== draft.saleItemId || !Number.isFinite(sku.sell_price) || sku.sell_price < 0) throw new Error("Pilih obat racik dari master");
  if (formula ? formula.version_id !== draft.formulaId : !allowCustom || draft.ingredients.length === 0 || draft.ingredients.some(row => !row.item_id || !Number.isFinite(row.qty) || row.qty <= 0)) throw new Error("Pilih komposisi racikan yang valid");
  return {
    key, item_id: null, sale_item_id: sku.id, nama_obat: sku.name, qty: 1, satuan: "racikan", faktor: 1,
    harga: sku.sell_price, jenis: "racikan" as const, official_version_id: formula?.version_id,
    ingredients: formula ? formula.ingredients.map(row => ({ item_id: row.item_id, nama: row.name, qty: row.quantity, satuan: row.unit, harga: row.unit_price })) : draft.ingredients,
    dosage_form: formula?.dosage_form ?? draft.dosageForm,
    aturan_pakai: formula ? (formula.dosage_instruction ?? undefined) : (draft.instruction.trim() || undefined),
  };
}
