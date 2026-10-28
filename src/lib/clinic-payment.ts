import { readCompleteList } from "./checked-list";
import { loadClinicSkuDetails } from "./clinic-compound-skus";
import { applyHargaCabang, hargaCabang } from "./harga-cabang";
import { unitOptions, type ItemUnit } from "./satuan";
import { penjualValid } from "./penjual";

export type ClinicPaymentMasterItem = {
  id: string; code: string; name: string; unit: string; harga: number; units: ItemUnit[]; tindakan_kategori: string | null;
};
type MasterRow = { id: string; code: string | null; name: string; unit: string | null; sell_price: number; item_type: string; tindakan_kategori: string | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadClinicPaymentMaster(client: any, branchId: string | null) {
  const rows = await readCompleteList<MasterRow>((from,to)=>client.from("items")
    .select("id,code,name,unit,sell_price,item_type,tindakan_kategori",{count:"exact"})
    .eq("is_active",true).order("name").order("id").range(from,to),"Barang & Jasa untuk pembayaran klinik");
  const details = await loadClinicSkuDetails(client,rows.map(row=>row.id),branchId);
  const master = rows.map(row=>({
    id:row.id,code:row.code??"",name:row.name,unit:row.unit||"pcs",tindakan_kategori:row.tindakan_kategori,
    harga:hargaCabang(details.prices,row.id,row.unit||"pcs",Number(row.sell_price)),
    units:applyHargaCabang(unitOptions({unit:row.unit,sell_price:Number(row.sell_price)},details.units.get(row.id)??[]),row.id,details.prices),
    jasa:row.item_type==="Jasa",
  }));
  return { obat:master.filter(row=>!row.jasa),jasa:master.filter(row=>row.jasa),all:master };
}

/** An explicit blank is intentionally unassigned. Defaults are eligible visit
 * employees only; the client never gets to assert its own branch membership. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveClinicSalesperson(client: any, branchId: string | null, doctorId: string | null, providerId: string | null, selected?: string): Promise<string|null> {
  if (selected!==undefined) {
    const id=selected.trim();if(!id)return null;
    if(!branchId || !(await penjualValid(client,id,branchId))) throw new Error("Penjual harus pegawai aktif yang bertugas di cabang kunjungan.");
    return id;
  }
  if(!branchId)return null;
  for(const id of [doctorId,providerId]) {
    if(id && await penjualValid(client,id,branchId))return id;
  }
  return null;
}

/** H05: a clinic package (Grup item) and the SKUs its recipe contains. */
export type ClinicPackageOption = { id: string; name: string; componentIds: string[];
  /** Base-unit quantity of each component in ONE package (the database checks line qty = packages x this). */
  perPaket: Record<string, number> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadClinicPackages(client: any): Promise<ClinicPackageOption[]> {
  type Row = { id: string; group_item_id: string; component_item_id: string; qty: number; factor: number; items: { name: string; is_active: boolean; item_type: string } | { name: string; is_active: boolean; item_type: string }[] | null };
  const rows = await readCompleteList<Row>((from,to)=>client.from("item_group_components")
    .select("id,group_item_id,component_item_id,qty,factor,items!item_group_components_group_item_id_fkey(name,is_active,item_type)",{count:"exact"})
    .order("id").range(from,to),"Paket klinik");
  const byPackage = new Map<string, ClinicPackageOption>();
  for (const row of rows) {
    const group = Array.isArray(row.items) ? row.items[0] ?? null : row.items;
    if (!group?.is_active || group.item_type !== "Grup") continue;
    const option = byPackage.get(row.group_item_id) ?? { id: row.group_item_id, name: group.name, componentIds: [], perPaket: {} };
    if (!option.componentIds.includes(row.component_item_id)) option.componentIds.push(row.component_item_id);
    option.perPaket[row.component_item_id] = (option.perPaket[row.component_item_id] ?? 0) + Number(row.qty) * Number(row.factor);
    byPackage.set(row.group_item_id, option);
  }
  return [...byPackage.values()].sort((a, b) => a.name.localeCompare(b.name, "id-ID"));
}
