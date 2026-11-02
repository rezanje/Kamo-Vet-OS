import { readCompleteList } from "./checked-list";
import { cacheSebentar, KATALOG_KASIR_UMUR_MS } from "./cache-memori";
import { loadClinicSkuDetails } from "./clinic-compound-skus";
import { applyHargaCabang, hargaCabang } from "./harga-cabang";
import { unitOptions, type ItemUnit } from "./satuan";
import { penjualValid } from "./penjual";
import { stokGudangKlinik } from "./stok-klinik";
import type { ResepPaket } from "./paket-klinik";

export type ClinicPaymentMasterItem = {
  id: string; code: string; name: string; unit: string; harga: number; units: ItemUnit[]; tindakan_kategori: string | null;
  /** Barang saja: stok satuan dasar gudang klinik cabang kunjungan; null = belum terbaca. */
  stokGudang?: number | null;
  /** Barang bertipe Grup (paket). */
  paket?: boolean;
};
type MasterRow = { id: string; code: string | null; name: string; unit: string | null; sell_price: number; item_type: string; tindakan_kategori: string | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadClinicPaymentMaster(client: any, branchId: string | null) {
  // Daftar barang aktif = master yang sama untuk semua pengguna (RLS select true);
  // disimpan sementara seperti katalog kasir (beban database 1 Nov 2026).
  const rows = await cacheSebentar("klinik:pembayaran-barang", KATALOG_KASIR_UMUR_MS, () => readCompleteList<MasterRow>((from,to)=>client.from("items")
    .select("id,code,name,unit,sell_price,item_type,tindakan_kategori",{count:"exact"})
    .eq("is_active",true).order("name").order("id").range(from,to),"Barang & Jasa untuk pembayaran klinik"));
  const details = await loadClinicSkuDetails(client,rows.map(row=>row.id),branchId);
  const master = rows.map(row=>({
    id:row.id,code:row.code??"",name:row.name,unit:row.unit||"pcs",tindakan_kategori:row.tindakan_kategori,
    harga:hargaCabang(details.prices,row.id,row.unit||"pcs",Number(row.sell_price)),
    units:applyHargaCabang(unitOptions({unit:row.unit,sell_price:Number(row.sell_price)},details.units.get(row.id)??[]),row.id,details.prices),
    jasa:row.item_type==="Jasa",
    // Paket (Grup) tidak punya stok sendiri; dipilih utuh lalu dipecah jadi isinya.
    ...(row.item_type==="Grup" ? {paket:true} : {}),
    ...(row.item_type==="Jasa" || row.item_type==="Grup" ? {} : {stokGudang:stokGudangKlinik(details,row.id)}),
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
  perPaket: Record<string, number>;
  /** Full recipe, for picking the package itself from the medicine list (2 Nov 2026). */
  resep?: ResepPaket };
type KomponenRow = { id: string; code: string | null; name: string; unit: string | null; item_type: string; is_active: boolean; tindakan_kategori: string | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadClinicPackages(client: any): Promise<ClinicPackageOption[]> {
  type Row = { id: string; group_item_id: string; component_item_id: string; qty: number; unit?: string | null; factor: number;
    items: { name: string; is_active: boolean; item_type: string } | { name: string; is_active: boolean; item_type: string }[] | null;
    component?: KomponenRow | KomponenRow[] | null };
  const rows = await readCompleteList<Row>((from,to)=>client.from("item_group_components")
    .select("id,group_item_id,component_item_id,qty,unit,factor,sort_order,items!item_group_components_group_item_id_fkey(name,is_active,item_type),component:component_item_id(id,code,name,unit,item_type,is_active,tindakan_kategori)",{count:"exact"})
    .order("group_item_id").order("sort_order").order("id").range(from,to),"Paket klinik");
  const byPackage = new Map<string, ClinicPackageOption & { rusak?: boolean }>();
  for (const row of rows) {
    const group = Array.isArray(row.items) ? row.items[0] ?? null : row.items;
    if (!group?.is_active || group.item_type !== "Grup") continue;
    const option = byPackage.get(row.group_item_id) ?? { id: row.group_item_id, name: group.name, componentIds: [], perPaket: {}, resep: { id: row.group_item_id, name: group.name, komponen: [] } };
    if (!option.componentIds.includes(row.component_item_id)) option.componentIds.push(row.component_item_id);
    option.perPaket[row.component_item_id] = (option.perPaket[row.component_item_id] ?? 0) + Number(row.qty) * Number(row.factor);
    const component = Array.isArray(row.component) ? row.component[0] ?? null : row.component;
    if (!component) option.rusak = true;
    else {
      // Isi nonaktif ditolak database saat posting: paketnya tidak ditawarkan untuk dipilih utuh.
      if (!component.is_active && component.item_type !== "Non-Persediaan") option.rusak = true;
      option.resep!.komponen.push({ item_id: row.component_item_id, name: component.name, item_type: component.item_type,
        base_unit: component.unit || "pcs", qty: Number(row.qty), unit: row.unit || component.unit || "pcs", factor: Number(row.factor),
        tindakan_kategori: component.tindakan_kategori });
    }
    byPackage.set(row.group_item_id, option);
  }
  return [...byPackage.values()].map(({ rusak, ...option }) => rusak ? { ...option, resep: undefined } : option)
    .sort((a, b) => a.name.localeCompare(b.name, "id-ID"));
}
