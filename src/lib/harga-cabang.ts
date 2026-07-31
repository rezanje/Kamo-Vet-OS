// Harga jual per cabang (migrasi 0073). Harga pusat ("Semua Cabang") tetap di
// items.sell_price / item_units.sell_price; tabel item_branch_prices cuma memuat
// pengecualian. Resolusi harga SELALU lewat sini supaya kasir, klinik, dan
// penjualan online tidak sempat memakai harga yang beda-beda.

import type { ItemUnit } from "./satuan";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type HargaCabang = Map<string, number>; // `${item_id}|${unit}` → harga

const kunci = (itemId: string, unit: string) => `${itemId}|${unit}`;

export async function loadHargaCabang(
  supabase: AnyClient,
  branchId: string | null | undefined,
  itemIds?: string[],
): Promise<HargaCabang> {
  const map: HargaCabang = new Map();
  if (!branchId) return map;
  let q = supabase.from("item_branch_prices").select("item_id, unit, sell_price").eq("branch_id", branchId);
  if (itemIds) {
    if (itemIds.length === 0) return map;
    q = q.in("item_id", itemIds);
  }
  const { data } = await q;
  for (const r of (data ?? []) as { item_id: string; unit: string; sell_price: number }[]) {
    map.set(kunci(r.item_id, r.unit), Number(r.sell_price));
  }
  return map;
}

// Harga cabang kalau ada, kalau tidak harga pusat. Nilai 0 tetap dihormati:
// gratis di satu cabang adalah keputusan yang sah, bukan "kosong".
export function hargaCabang(
  map: HargaCabang,
  itemId: string,
  unit: string | null | undefined,
  hargaPusat: number,
): number {
  const v = map.get(kunci(itemId, (unit ?? "") || ""));
  return v === undefined ? Number(hargaPusat) || 0 : v;
}

// Tempel harga cabang ke daftar satuan hasil unitOptions().
export function applyHargaCabang(options: ItemUnit[], itemId: string, map: HargaCabang): ItemUnit[] {
  if (map.size === 0) return options;
  return options.map((o) => ({ ...o, sell_price: hargaCabang(map, itemId, o.unit, o.sell_price) }));
}
