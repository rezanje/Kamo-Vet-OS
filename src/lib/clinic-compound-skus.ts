import { ListLoadError, readCompleteList } from "./checked-list";
import type { ItemUnit } from "./satuan";
import type { HargaCabang } from "./harga-cabang";

export type CompoundSkuRow = {
  id: string; code: string | null; name: string; unit: string; sell_price: number;
  is_compound_material: boolean; item_type: string; tindakan_kategori: string | null;
};

/** Imported finished medicines belong to master categories, not formula versions.
 * Never invent ingredients or convert their stock into a clinical recipe. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadClinicCompoundSkus(client: any): Promise<CompoundSkuRow[]> {
  const categories = await readCompleteList<{ id: string; name: string }>((from, to) => client
    .from("item_categories").select("id,name", { count: "exact" })
    .order("id").range(from, to), "Kategori obat racik");
  const categoryIds = categories.filter(c => ["OBAT RACIK", "OBAT RACIKAN", "RACIKAN"].includes(
    c.name.trim().replace(/\s+/g, " ").toUpperCase(),
  )).map(c => c.id);
  const choices = ["name.ilike.Obat Racik *", "name.ilike.Obat Racikan *"];
  if (categoryIds.length) choices.push(`category_id.in.(${categoryIds.join(",")})`);
  return readCompleteList<CompoundSkuRow>((from, to) => client.from("items")
    .select("id,code,name,unit,sell_price,is_compound_material,item_type,tindakan_kategori", { count: "exact" })
    .or(choices.join(",")).eq("is_active", true)
    .eq("item_type", "Persediaan").eq("is_compound_material", false)
    .order("name").order("id").range(from, to), "Obat racik dari Barang & Jasa");
}

/** Match clinic posting's warehouse and check every lookup page. Small ID batches
 * keep request URLs bounded even when the compound catalogue exceeds 1,000. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadClinicSkuDetails(client: any, itemIds: string[], branchId: string | null) {
  const stock = new Map<string, number>();
  const units = new Map<string, ItemUnit[]>();
  const prices: HargaCabang = new Map();
  const { data: warehouse, error } = branchId ? await client.from("warehouses").select("id")
    .eq("branch_id", branchId).eq("type", "VET").eq("is_active", true)
    .order("created_at").order("id").limit(1).maybeSingle() : { data: null, error: null };
  if (error) throw new ListLoadError("Gudang klinik belum dapat dimuat. Coba muat ulang.");
  const ids = [...new Set(itemIds)];
  for (let start = 0; start < ids.length; start += 200) {
    const batch = ids.slice(start, start + 200);
    const [stockRows, unitRows, priceRows] = await Promise.all([
      warehouse ? readCompleteList<{ id: string; item_id: string; qty: number }>((from, to) => client.from("stock")
        .select("id,item_id,qty", { count: "exact" }).eq("warehouse_id", warehouse.id).in("item_id", batch)
        .order("id").range(from, to), "Stok gudang klinik") : [],
      readCompleteList<{ id: string; item_id: string } & ItemUnit>((from, to) => client.from("item_units")
        .select("id,item_id,unit,factor,sell_price,buy_price", { count: "exact" }).in("item_id", batch)
        .order("id").range(from, to), "Satuan barang klinik"),
      branchId ? readCompleteList<{ id: string; item_id: string; unit: string; sell_price: number }>((from, to) => client.from("item_branch_prices")
        .select("id,item_id,unit,sell_price", { count: "exact" }).eq("branch_id", branchId).in("item_id", batch)
        .order("id").range(from, to), "Harga barang cabang") : [],
    ]);
    for (const row of stockRows) stock.set(row.item_id, (stock.get(row.item_id) ?? 0) + Number(row.qty));
    for (const row of unitRows) {
      const list = units.get(row.item_id) ?? [];
      list.push({ unit: row.unit, factor: Number(row.factor), sell_price: Number(row.sell_price), buy_price: Number(row.buy_price) });
      units.set(row.item_id, list);
    }
    for (const row of priceRows) prices.set(`${row.item_id}|${row.unit}`, Number(row.sell_price));
  }
  return { stock, units, prices };
}
