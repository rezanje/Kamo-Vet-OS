import type { StockCorrectionBlocked } from "@/lib/stock-correction-types";

/** Membaca daftar baris tertahan dari hasil RPC (array) atau dari `details` galat (teks JSON). Bentuk yang tidak dikenal menghasilkan undefined. */
export function parseBlocked(value: unknown): StockCorrectionBlocked[] | undefined {
  let raw = value;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return undefined; }
  }
  if (!Array.isArray(raw)) return undefined;
  const out: StockCorrectionBlocked[] = [];
  for (const entry of raw) {
    const row = entry as Partial<StockCorrectionBlocked> | null;
    if (!row || typeof row.name !== "string" || typeof row.reason !== "string") return undefined;
    out.push({
      ...(typeof row.item_id === "string" ? { item_id: row.item_id } : {}),
      name: row.name,
      ...(typeof row.old_qty === "number" ? { old_qty: row.old_qty } : {}),
      ...(typeof row.new_qty === "number" ? { new_qty: row.new_qty } : {}),
      reason: row.reason,
    });
  }
  return out;
}
