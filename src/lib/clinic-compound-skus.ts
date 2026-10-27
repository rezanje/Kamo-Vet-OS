import { ListLoadError, readCompleteList } from "./checked-list";
import type { ItemUnit } from "./satuan";
import type { HargaCabang } from "./harga-cabang";
import { loadClinicItemCategories, type ClinicItemCategory } from "./clinic-item-categories";

export type CompoundSkuRow = {
  id: string; code: string | null; name: string; unit: string; sell_price: number;
  is_compound_material: boolean; item_type: string; tindakan_kategori: string | null;
  category_id: string | null;
};

/** Imported finished medicines belong to master categories, not formula versions.
 * Never invent ingredients or convert their stock into a clinical recipe. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadClinicCompoundSkus(client: any, categories?: ClinicItemCategory[]): Promise<CompoundSkuRow[]> {
  categories ??= await loadClinicItemCategories(client);
  const categoryIds = new Set(categories.filter(c => ["OBAT RACIK", "OBAT RACIKAN", "RACIKAN"].includes(
    c.name.trim().replace(/\s+/g, " ").toUpperCase(),
  )).map(c => c.id));
  // Finished medicines may be filed under a child of the Racikan category.
  // Keep the same active/inventory/non-material eligibility for every child.
  for (let added = true; added;) {
    added = false;
    for (const category of categories) {
      if (category.parent_id && categoryIds.has(category.parent_id) && !categoryIds.has(category.id)) {
        categoryIds.add(category.id);
        added = true;
      }
    }
  }
  const choices = ["name.ilike.Obat Racik *", "name.ilike.Obat Racikan *"];
  if (categoryIds.size) choices.push(`category_id.in.(${[...categoryIds].join(",")})`);
  return readCompleteList<CompoundSkuRow>((from, to) => client.from("items")
    .select("id,code,name,unit,sell_price,is_compound_material,item_type,tindakan_kategori,category_id", { count: "exact" })
    .or(choices.join(",")).eq("is_active", true)
    .eq("item_type", "Persediaan").eq("is_compound_material", false)
    .order("name").order("id").range(from, to), "Obat racik dari Barang & Jasa");
}

const SKU_BATCH_CONCURRENCY = 6;

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
  const batches: string[][] = [];
  for (let start = 0; start < ids.length; start += 200) batches.push(ids.slice(start, start + 200));
  // U07: batches used to run one after another (±19 sequential trips for the full
  // clinic catalogue). Run a few at once; results are still applied in order.
  const loadBatch = (batch: string[]) => Promise.all([
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
  const results: Awaited<ReturnType<typeof loadBatch>>[] = [];
  for (let start = 0; start < batches.length; start += SKU_BATCH_CONCURRENCY) {
    results.push(...await Promise.all(batches.slice(start, start + SKU_BATCH_CONCURRENCY).map(loadBatch)));
  }
  for (const [stockRows, unitRows, priceRows] of results) {
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
