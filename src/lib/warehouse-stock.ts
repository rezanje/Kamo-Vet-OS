import { readCompleteList } from "./checked-list";

/** Quantities are stored in the item's base unit, separately for each warehouse. */
/** `average_cost` = HPP rata-rata bergerak per satuan dasar (null bila belum ada / metode FIFO). */
export type WarehouseStock = { id: string; warehouse_id: string; item_id: string; qty: number; average_cost?: number | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadWarehouseStock(client: any, warehouseIds: string[]): Promise<WarehouseStock[]> {
  const ids = [...new Set(warehouseIds.filter(Boolean))];
  if (!ids.length) return [];
  return readCompleteList<WarehouseStock>((from, to) => client.from("stock")
    .select("id,warehouse_id,item_id,qty,average_cost", { count: "exact" }).in("warehouse_id", ids)
    .order("id").range(from, to), "Stok gudang", { maxRows: null });
}
