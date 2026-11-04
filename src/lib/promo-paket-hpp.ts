// Taksiran harga normal & HPP barang hasil untuk editor Promo Paket (hanya BACA).
// HPP = biaya lapisan stok tertinggi yang masih tersisa di gudang cabang terpilih (konservatif, sikap yang sama dengan
// quoteSaleLineCosts di kasir); bila tak ada lapisan, harga beli master; bila keduanya kosong → tidak diketahui (null),
// TIDAK PERNAH dianggap 0. Harga = harga jual master satuan itu (harga khusus cabang tidak dibaca di sini).
import { readCompleteList } from "./checked-list";
import type { PaketItemRef } from "./promo-paket";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;
export type HppItemRow = { id: string; unit: string; sell_price: number | string | null; buy_price: number | string | null };
export type HppUnitRow = { item_id: string; unit: string; factor: number | string; sell_price: number | string | null };
export type HppLayer = { item_id: string; unit_cost: number | string | null };
export type HppRow = { item_id: string; unit: string; price: number; hpp: number | null; source: "lapisan" | "harga_beli" | null };

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function hitungHppPaket(refs: readonly PaketItemRef[], items: readonly HppItemRow[], units: readonly HppUnitRow[], layers: readonly HppLayer[]): HppRow[] {
  const itemById = new Map(items.map((i) => [i.id, i]));
  return refs.map((r) => {
    const item = itemById.get(r.item_id);
    const unitRow = units.find((u) => u.item_id === r.item_id && u.unit === r.unit);
    const base = !!item && item.unit === r.unit;
    if (!item || (!base && !unitRow)) return { item_id: r.item_id, unit: r.unit, price: 0, hpp: null, source: null };
    const factor = base ? 1 : num(unitRow!.factor);
    const price = Math.round(num(base ? item.sell_price : unitRow!.sell_price));
    const layerCost = Math.max(0, ...layers.filter((l) => l.item_id === r.item_id).map((l) => num(l.unit_cost)));
    const buy = num(item.buy_price);
    const cost = layerCost > 0 ? layerCost : buy > 0 ? buy : 0;
    if (cost <= 0 || factor <= 0) return { item_id: r.item_id, unit: r.unit, price, hpp: null, source: null };
    return { item_id: r.item_id, unit: r.unit, price, hpp: Math.round(cost * factor), source: layerCost > 0 ? "lapisan" : "harga_beli" };
  });
}

const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Membaca (select saja). Melempar bila ada pembacaan yang gagal: pemanggil tidak boleh menganggapnya "tidak ada rugi". */
export async function loadPaketHpp(supabase: AnyClient, refs: readonly PaketItemRef[], branchIds: readonly string[]): Promise<HppRow[]> {
  const ids = [...new Set(refs.map((r) => r.item_id))];
  if (ids.length === 0) return [];
  const items: HppItemRow[] = [], units: HppUnitRow[] = [], layers: HppLayer[] = [];
  for (const part of chunks(ids, 100)) {
    items.push(...await readCompleteList<HppItemRow>((from, to) => supabase.from("items").select("id,unit,sell_price,buy_price", { count: "exact" }).in("id", part).order("id").range(from, to), "Barang promo", { maxRows: null }));
    units.push(...await readCompleteList<HppUnitRow & { id: string }>((from, to) => supabase.from("item_units").select("id,item_id,unit,factor,sell_price", { count: "exact" }).in("item_id", part).order("item_id").order("unit").range(from, to), "Satuan barang promo", { maxRows: null }));
  }
  let warehouses = supabase.from("warehouses").select("id", { count: "exact" });
  if (branchIds.length) warehouses = warehouses.in("branch_id", [...branchIds]);
  const wh = await readCompleteList<{ id: string }>((from, to) => warehouses.order("id").range(from, to), "Gudang cabang promo", { maxRows: null });
  const warehouseIds = wh.map((w) => w.id);
  if (warehouseIds.length) {
    for (const part of chunks(ids, 100)) {
      layers.push(...await readCompleteList<HppLayer & { id: string }>((from, to) => supabase.from("stock_layers").select("id,item_id,unit_cost", { count: "exact" })
        .in("item_id", part).in("warehouse_id", warehouseIds.slice(0, 200)).gt("qty_left", 0).order("id").range(from, to), "Lapisan HPP promo", { maxRows: null }));
    }
  }
  return hitungHppPaket(refs, items, units, layers);
}
