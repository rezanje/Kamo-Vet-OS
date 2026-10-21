import { readCompleteList } from "./checked-list";

/** Quantities are stored in the item's base unit, separately for each warehouse. */
export type WarehouseStock = { id: string; warehouse_id: string; item_id: string; qty: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadWarehouseStock(client: any, warehouseIds: string[]): Promise<WarehouseStock[]> {
  const ids = [...new Set(warehouseIds.filter(Boolean))];
  if (!ids.length) return [];
  return readCompleteList<WarehouseStock>((from, to) => client.from("stock")
    .select("id,warehouse_id,item_id,qty", { count: "exact" }).in("warehouse_id", ids)
    .order("id").range(from, to), "Stok gudang", { maxRows: null });
}
