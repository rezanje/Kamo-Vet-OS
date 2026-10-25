import { StockDecimal } from "./initial-stock-decimal";

type Evidence = Record<string, unknown>;
type Basis = { qty: InstanceType<typeof StockDecimal>; value: InstanceType<typeof StockDecimal> };
type Bucket = { itemId: string; warehouseId: string; code: string; source: Basis; layer: Basis; move: Basis };

export type InventoryBasisRow = {
  itemId: string; warehouseId: string; code: string;
  sourceQty: string; sourceValue: string; layerQty: string; layerValue: string; moveQty: string; moveValue: string;
  status: "pending" | "match" | "mismatch";
};

const empty = (): Basis => ({ qty: new StockDecimal(0), value: new StockDecimal(0) });
const object = (value: unknown): Evidence | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Evidence : null;
const decimal = (value: unknown) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  try { const number = new StockDecimal(value); return number.isFinite() ? number : null; } catch { return null; }
};

/** Read-only evidence from the canonical preview RPC. Current stock may have been consumed,
 * so this compares the original source with original layers and moves, not today's balance. */
export function inventoryBasisRows(report: { status: string; selected_rows: number; evidence?: unknown }): { rows: InventoryBasisRow[]; complete: boolean } {
  const evidence = object(report.evidence);
  const source = evidence?.rows, layers = evidence?.source_layers, moves = evidence?.source_moves;
  if (!Array.isArray(source) || !Array.isArray(layers) || !Array.isArray(moves)) return { rows: [], complete: false };
  const buckets = new Map<string, Bucket>();
  let valid = true, selected = 0;
  const add = (kind: "source" | "layer" | "move", item: unknown) => {
    const entry = object(item), payload = kind === "source" ? object(entry?.payload) : entry;
    const itemId = payload?.item_id, warehouseId = payload?.warehouse_id;
    const qty = decimal(payload?.[kind === "source" ? "base_qty" : kind === "layer" ? "qty_in" : "qty"]);
    const cost = decimal(payload?.[kind === "source" ? "base_unit_cost" : "unit_cost"]);
    if (typeof itemId !== "string" || !itemId || typeof warehouseId !== "string" || !warehouseId || !qty || !cost || qty.lte(0) || cost.lt(0)) { valid = false; return; }
    const key = `${warehouseId}\0${itemId}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { itemId, warehouseId, code: itemId, source: empty(), layer: empty(), move: empty() };
      buckets.set(key, bucket);
    }
    if (kind === "source" && typeof entry?.code === "string" && entry.code) bucket.code = entry.code;
    bucket[kind].qty = bucket[kind].qty.plus(qty);
    bucket[kind].value = bucket[kind].value.plus(qty.times(cost));
  };
  for (const row of source) {
    const entry = object(row);
    if (entry?.status !== (report.status === "posted" ? "posted" : "valid")) continue;
    selected += 1;
    add("source", entry);
  }
  for (const row of layers) add("layer", row);
  for (const row of moves) add("move", row);
  const posted = report.status === "posted";
  const rows = [...buckets.values()].map(bucket => ({
    itemId: bucket.itemId, warehouseId: bucket.warehouseId, code: bucket.code,
    sourceQty: bucket.source.qty.toFixed(), sourceValue: bucket.source.value.toFixed(),
    layerQty: bucket.layer.qty.toFixed(), layerValue: bucket.layer.value.toFixed(),
    moveQty: bucket.move.qty.toFixed(), moveValue: bucket.move.value.toFixed(),
    status: !posted ? "pending" as const :
      bucket.source.qty.eq(bucket.layer.qty) && bucket.source.qty.eq(bucket.move.qty) &&
      bucket.source.value.eq(bucket.layer.value) && bucket.source.value.eq(bucket.move.value) ? "match" as const : "mismatch" as const,
  })).sort((a, b) => a.warehouseId.localeCompare(b.warehouseId) || a.code.localeCompare(b.code));
  return { rows, complete: valid && selected === report.selected_rows && selected > 0 };
}
