import { readCompleteList } from "./checked-list";
import { hariIniWIB } from "./tanggal";
import { cashierLineCosts, cashierStockCostEvents, quoteCashierLineCosts } from "./cashier-price-floor";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;
type QuoteLine = {
  item_id: string | null; item_type?: string; qty: number; faktor?: number;
  group_components?: { item_type: string; component_item_id: string; total_base_qty: number }[];
};
type Layer = { id: string; item_id: string; qty_left: number; unit_cost: number; exp_date: string | null; tanggal: string; created_at: string };

/**
 * Perkiraan HPP FIFO per baris penjualan dari lapisan stok gudang saat ini (urutan FEFO/FIFO
 * yang sama dengan pengeluaran stok). Baris Persediaan memakai biayanya sendiri; baris Grup
 * memakai jumlah biaya komponen Persediaannya. Jasa → null. Lapisan tanpa harga atau stok
 * kurang ditutup biaya tertinggi yang pernah diketahui (konservatif).
 * `knownBuyPrices` = harga beli master; boleh kosong. Melempar Error bila data tidak terbaca.
 */
export async function quoteSaleLineCosts(
  supabase: AnyClient, warehouseId: string, lines: QuoteLine[], knownBuyPrices: Map<string, number> = new Map(),
): Promise<(number | null)[]> {
  const stockEvents = cashierStockCostEvents(lines.map(line => ({
    item_id: line.item_id ?? "", item_type: line.item_id ? line.item_type : undefined, qty: line.qty, faktor: line.faktor,
    group_components: line.group_components,
  })));
  if (stockEvents.length === 0) return lines.map(() => null);
  const inventoryIds = [...new Set(stockEvents.map(event => event.item_id))];
  const layers = await readCompleteList<Layer>((from, to) => supabase.from("stock_layers")
    .select("id,item_id,qty_left,unit_cost,exp_date,tanggal,created_at", { count: "exact" })
    .eq("warehouse_id", warehouseId).in("item_id", inventoryIds).order("id").range(from, to),
  "Lapisan HPP kasir", { maxRows: null });
  const costReads = await Promise.all(inventoryIds.map(async itemId => {
    const { data, error } = await supabase.from("stock_moves")
      .select("item_id,unit_cost").eq("warehouse_id", warehouseId).eq("item_id", itemId)
      .gt("qty", 0).gt("unit_cost", 0).lte("tanggal", hariIniWIB())
      .not("source", "in", '("sale-void","purchase-invoice-void")')
      .order("unit_cost", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    return (data ?? []) as { item_id: string; unit_cost: number }[];
  }));
  const knownMoves = costReads.flat();
  const sortLayers = (a: Layer, b: Layer) =>
    (a.exp_date == null && b.exp_date != null ? 1 : a.exp_date != null && b.exp_date == null ? -1 : a.exp_date && b.exp_date ? a.exp_date.localeCompare(b.exp_date) : 0)
    || a.tanggal.localeCompare(b.tanggal) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
  const knownCosts = new Map(inventoryIds.map(itemId => [itemId, Math.max(Number(knownBuyPrices.get(itemId)) || 0,
    ...layers.filter(layer => layer.item_id === itemId).map(layer => Number(layer.unit_cost)),
    ...knownMoves.filter(move => move.item_id === itemId).map(move => Number(move.unit_cost)))]));
  const eventCosts = quoteCashierLineCosts(stockEvents, layers.filter(layer => Number(layer.qty_left) > 0).sort(sortLayers), knownCosts);
  return cashierLineCosts(lines.length, stockEvents, eventCosts);
}
