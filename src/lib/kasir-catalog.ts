import { readCompleteList } from "./checked-list";
import type { ItemType } from "./barang";
import type { AturanDiskon } from "./harga-golongan";

type Rel<T> = T | T[] | null;
export type KasirCatalogItem = {
  id: string; code: string; name: string; unit: string; item_type: ItemType;
  sell_price: number; buy_price: number; target_species: string;
  min_sell_qty: number; default_discount: number; substitute_item_id: string | null;
  category_id: string | null;
  item_categories: Rel<{ name: string; parent_id: string | null }>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadKasirItems(client: any): Promise<KasirCatalogItem[]> {
  return readCompleteList<KasirCatalogItem>((from, to) => client.from("items")
    .select("id,code,name,unit,item_type,sell_price,buy_price,target_species,min_sell_qty,default_discount,substitute_item_id,category_id,item_categories(name,parent_id)", { count: "exact" })
    .eq("is_active", true).order("name").order("id").range(from, to), "Daftar barang kasir", { maxRows: null });
}

/** Every lookup must be complete too: later products need their actual stock,
 * branch price and discounts, not defaults caused by the API row limit. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadKasirCatalogDetails(client: any, branchId: string, warehouseId: string | null) {
  const [stock, prices, tiers, discounts] = await Promise.all([
    warehouseId ? readCompleteList<{ id: string; item_id: string; qty: number }>((from, to) => client.from("stock")
      .select("id,item_id,qty", { count: "exact" }).eq("warehouse_id", warehouseId)
      .order("id").range(from, to), "Stok kasir", { maxRows: null }) : [],
    readCompleteList<{ id: string; item_id: string; unit: string; sell_price: number }>((from, to) => client.from("item_branch_prices")
      .select("id,item_id,unit,sell_price", { count: "exact" }).eq("branch_id", branchId)
      .order("id").range(from, to), "Harga cabang kasir", { maxRows: null }),
    readCompleteList<{ id: string; item_id: string; min_qty: number; harga: number }>((from, to) => client.from("item_price_tiers")
      .select("id,item_id,min_qty,harga", { count: "exact" }).order("min_qty").order("id")
      .range(from, to), "Harga bertingkat kasir", { maxRows: null }),
    readCompleteList<AturanDiskon & { id: string; customer_category_id: string }>((from, to) => client.from("category_discounts")
      .select("id,customer_category_id,item_id,item_category_id,diskon_persen", { count: "exact" })
      .order("id").range(from, to), "Diskon golongan kasir", { maxRows: null }),
  ]);
  return { stock, prices, tiers, discounts };
}

export type KasirGroupComponent = {
  id: string; group_item_id: string; component_item_id: string; qty: number;
  unit: string; factor: number; sort_order: number;
  component: Rel<{ id: string; code: string; name: string; item_type: ItemType; is_active: boolean }>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadKasirGroupComponents(client: any, groupIds: string[]): Promise<KasirGroupComponent[]> {
  const rows: KasirGroupComponent[] = [];
  for (let start = 0; start < groupIds.length; start += 200) {
    const batch = groupIds.slice(start, start + 200);
    rows.push(...await readCompleteList<KasirGroupComponent>((from, to) => client.from("item_group_components")
      .select("id,group_item_id,component_item_id,qty,unit,factor,sort_order,component:component_item_id(id,code,name,item_type,is_active)", { count: "exact" })
      .in("group_item_id", batch).order("sort_order").order("id").range(from, to), "Komponen paket kasir", { maxRows: null }));
  }
  return rows;
}
