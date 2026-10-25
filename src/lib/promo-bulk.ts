import type { PromoExcelRow } from "./promo-excel";

export type PromoCatalogItem = { id: string; code: string; name: string; unit: string; is_active: boolean };
export type PromoCatalogUnit = { item_id: string; unit: string };
export type PromoReviewedRow = PromoExcelRow & {
  item_name: string | null;
  error: string | null;
};
export type PromoSaveRow = { code: string; unit: string; discount_type: "percent" | "nominal"; discount_value: number };

export function validatePromoRows(
  rows: PromoExcelRow[], items: PromoCatalogItem[], units: PromoCatalogUnit[],
): { reviewed: PromoReviewedRow[]; valid: PromoSaveRow[] } {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) throw new Error("Impor promo harus berisi 1 sampai 500 baris");
  const byCode = new Map(items.map(item => [item.code, item]));
  const unitKeys = new Set(units.map(unit => `${unit.item_id}\u001f${unit.unit}`));
  const seen = new Set<string>();
  const valid: PromoSaveRow[] = [];
  const reviewed = rows.map((row, index) => {
    const line = Number.isInteger(row.line) && row.line >= 2 ? row.line : index + 2;
    const code = String(row.code ?? "").trim();
    const unit = String(row.unit ?? "").trim();
    const rawKind = String(row.discount_type ?? "").trim().toLowerCase();
    const kind = rawKind === "persen" ? "percent" : rawKind;
    const rawValue = String(row.discount_value ?? "").trim();
    const amount = rawValue && /^\d+(?:\.\d{1,2})?$/.test(rawValue) ? Number(rawValue) : NaN;
    const item = byCode.get(code);
    const key = `${code}\u001f${unit}`;
    let error: string | null = null;
    if (!code || !unit) error = "Kode barang dan satuan wajib diisi";
    else if (seen.has(key)) error = "SKU dan satuan duplikat dalam file";
    else if (!item?.is_active) error = "SKU tidak ada atau nonaktif";
    else if (unit !== item.unit && !unitKeys.has(`${item.id}\u001f${unit}`)) error = "Satuan tidak terdaftar untuk SKU ini";
    else if (kind !== "percent" && kind !== "nominal") error = "Jenis diskon harus Persen atau Nominal";
    else if (!Number.isFinite(amount) || amount <= 0 || (kind === "percent" && amount > 100)) error = "Nilai diskon harus positif, maksimal 100 untuk Persen, dan maksimal dua desimal";
    seen.add(key);
    if (!error) valid.push({ code, unit, discount_type: kind as "percent" | "nominal", discount_value: amount });
    return { line, code, unit, discount_type: kind, discount_value: rawValue, item_name: item?.name ?? null, error };
  });
  return { reviewed, valid };
}
