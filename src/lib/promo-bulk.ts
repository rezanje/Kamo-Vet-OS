import type { PromoExcelRow } from "./promo-excel";
import { convertFinalPrice, type FinalPriceBranch, type FinalPriceBranchPrice, type FinalPriceMoney } from "./promo-final-price";

export type PromoCatalogItem = {
  id: string; code: string; name: string; unit: string; is_active: boolean;
  item_type?: string | null; sell_price?: FinalPriceMoney; buy_price?: FinalPriceMoney;
};
export type PromoCatalogUnit = { item_id: string; unit: string; sell_price?: FinalPriceMoney; buy_price?: FinalPriceMoney; factor?: FinalPriceMoney };
/** Price context for "Harga Akhir" rows; without it such rows are rejected (never guessed). */
export type PromoPricing = { scope: FinalPriceBranch[] | null; branchPrices: FinalPriceBranchPrice[]; tierItemIds: string[] };
export type PromoReviewedRow = PromoExcelRow & {
  item_name: string | null;
  error: string | null;
  /** Only for Harga Akhir rows (null otherwise): what the preview showed, and what save is bound to. */
  normal_price?: number | null;
  final_price?: number | null;
  potongan?: number | null;
  percent_off?: number | null;
  /** The registered unit spelling that matched exactly (never normalized). */
  matched_unit?: string | null;
  /** Non-blocking note (e.g. master HPP not filled in). Always derived server side; the row stays valid. */
  warning?: string | null;
};
export type PromoSaveRow = { code: string; unit: string; discount_type: "percent" | "nominal"; discount_value: number };

export function validatePromoRows(
  rows: PromoExcelRow[], items: PromoCatalogItem[], units: PromoCatalogUnit[], pricing?: PromoPricing,
): { reviewed: PromoReviewedRow[]; valid: PromoSaveRow[] } {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) throw new Error("Impor promo harus berisi 1 sampai 500 baris");
  const byCode = new Map(items.map(item => [item.code, item]));
  const unitKeys = new Set(units.map(unit => `${unit.item_id}\u001f${unit.unit}`));
  const unitRows = new Map(units.map(unit => [`${unit.item_id}\u001f${unit.unit}`, unit]));
  const tierItems = new Set(pricing?.tierItemIds ?? []);
  const seen = new Set<string>();
  const valid: PromoSaveRow[] = [];
  const reviewed = rows.map((row, index) => {
    const line = Number.isInteger(row.line) && row.line >= 2 ? row.line : index + 2;
    const code = String(row.code ?? "").trim();
    const unit = String(row.unit ?? "").trim();
    const rawKind = String(row.discount_type ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    const kind = rawKind === "persen" ? "percent" : rawKind === "harga akhir" || rawKind === "harga akhir promo" || rawKind === "final_price" ? "final_price" : rawKind;
    const rawValue = String(row.discount_value ?? "").trim();
    const amount = rawValue && /^\d+(?:\.\d{1,2})?$/.test(rawValue) ? Number(rawValue) : NaN;
    const item = byCode.get(code);
    const key = `${code}\u001f${unit}`;
    const extra: Pick<PromoReviewedRow, "normal_price" | "final_price" | "potongan" | "percent_off" | "matched_unit" | "warning"> =
      { normal_price: null, final_price: null, potongan: null, percent_off: null, matched_unit: null, warning: null };
    let nominal = amount;
    let error: string | null = null;
    if (!code || !unit) error = "Kode barang dan satuan wajib diisi";
    else if (seen.has(key)) error = "SKU dan satuan duplikat dalam file";
    else if (!item?.is_active) error = "SKU tidak ada atau nonaktif";
    else if (unit !== item.unit && !unitKeys.has(`${item.id}\u001f${unit}`)) {
      const registered = [item.unit, ...units.filter(entry => entry.item_id === item.id).map(entry => entry.unit)]
        .find(candidate => candidate.toLowerCase() === unit.toLowerCase());
      error = registered
        ? `Satuan tidak terdaftar untuk SKU ini. Satuan terdaftar: ${registered} (huruf besar/kecil harus sama persis, tidak diperbaiki otomatis)`
        : "Satuan tidak terdaftar untuk SKU ini";
    } else {
      extra.matched_unit = unit;
      if (kind !== "percent" && kind !== "nominal" && kind !== "final_price") error = "Jenis diskon harus Persen, Nominal, atau Harga Akhir";
      else if (kind === "final_price") {
        const converted = convertFinalPrice({
          raw: rawValue, unit, item, unitRow: unit === item.unit ? null : unitRows.get(`${item.id}\u001f${unit}`) ?? null,
          scope: pricing?.scope ?? null, branchPrices: pricing?.branchPrices ?? [],
          hasQuantityTiers: tierItems.has(item.id),
        });
        if (!pricing) error = "Harga normal tidak dapat dibaca; harga akhir tidak bisa dihitung";
        else if (!converted.ok) { error = converted.error; extra.normal_price = converted.normalPrice ?? null; }
        else {
          nominal = converted.potongan;
          Object.assign(extra, { normal_price: converted.normalPrice, final_price: converted.finalPrice, potongan: converted.potongan, percent_off: converted.percentOff, warning: converted.warning ?? null });
        }
      } else if (!Number.isFinite(amount) || amount <= 0 || (kind === "percent" && amount > 100)) error = "Nilai diskon harus positif, maksimal 100 untuk Persen, dan maksimal dua desimal";
    }
    seen.add(key);
    if (!error) valid.push({ code, unit, discount_type: kind === "percent" ? "percent" : "nominal", discount_value: nominal });
    return { line, code, unit, discount_type: kind, discount_value: rawValue, item_name: item?.name ?? null, error, ...extra };
  });
  return { reviewed, valid };
}
