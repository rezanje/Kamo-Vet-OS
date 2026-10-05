import { readCompleteList } from "./checked-list";
import { loadClinicSkuDetails } from "./clinic-compound-skus";
import { applyHargaCabang, hargaCabang } from "./harga-cabang";
import { unitOptions, type ItemUnit } from "./satuan";
import { penjualValid } from "./penjual";

export type ClinicPaymentMasterItem = {
  id: string; code: string; name: string; unit: string; harga: number; units: ItemUnit[];
};
type MasterRow = { id: string; code: string | null; name: string; unit: string | null; sell_price: number; item_type: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadClinicPaymentMaster(client: any, branchId: string | null) {
  const rows = await readCompleteList<MasterRow>((from,to)=>client.from("items")
    .select("id,code,name,unit,sell_price,item_type",{count:"exact"})
    .eq("is_active",true).order("name").order("id").range(from,to),"Barang & Jasa untuk pembayaran klinik");
  const details = await loadClinicSkuDetails(client,rows.map(row=>row.id),branchId);
  const master = rows.map(row=>({
    id:row.id,code:row.code??"",name:row.name,unit:row.unit||"pcs",
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
