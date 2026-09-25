import type { BarisInput } from "./penjualan-server";
import { unitOptions, type ItemUnit } from "./satuan";

type ItemMaster = { id: string; name: string; unit: string | null; sell_price: number };
type UnitMaster = ItemUnit & { item_id: string };

// Penawaran dan pesanan menjadi sumber faktor stok saat pengiriman. Jangan
// menyimpan faktor dari JSON form atau diam-diam mengubah snapshot satuan lama.
export function cocokkanSatuanJual(
  baris: BarisInput[], items: ItemMaster[], extra: UnitMaster[],
): { rows: BarisInput[]; error: string | null } {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const extraMap = new Map<string, ItemUnit[]>();
  for (const unit of extra) extraMap.set(unit.item_id, [...(extraMap.get(unit.item_id) ?? []), unit]);

  const rows: BarisInput[] = [];
  for (const row of baris) {
    if (!row.item_id) {
      rows.push({ ...row, item_id: null, satuan: null, faktor: 1 });
      continue;
    }
    const item = itemMap.get(row.item_id);
    if (!item) return { rows: [], error: `Barang ${row.nama} tidak aktif atau tidak ditemukan. Pilih lagi dari master.` };
    const option = unitOptions({ unit: item.unit, sell_price: item.sell_price }, extraMap.get(item.id) ?? [])
      .find((candidate) => candidate.unit === row.satuan);
    if (!option || Number(row.faktor) !== option.factor) {
      return { rows: [], error: `Satuan atau faktor ${item.name} berubah. Pilih barang dan satuannya lagi.` };
    }
    rows.push({ ...row, satuan: option.unit, faktor: option.factor });
  }
  return { rows, error: null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function validasiSatuanJual(supabase: any, baris: BarisInput[]) {
  const ids = [...new Set(baris.map((row) => row.item_id).filter((id): id is string => !!id))];
  if (!ids.length) return cocokkanSatuanJual(baris, [], []);
  const [items, units] = await Promise.all([
    supabase.from("items").select("id, name, unit, sell_price").in("id", ids).eq("is_active", true),
    supabase.from("item_units").select("item_id, unit, factor, sell_price, buy_price").in("item_id", ids),
  ]);
  if (items.error || units.error) return { rows: [] as BarisInput[], error: "Satuan barang belum bisa diverifikasi. Coba lagi." };
  return cocokkanSatuanJual(baris, items.data ?? [], units.data ?? []);
}
