import { type ItemUnit, loadUnitOptions } from './satuan';
import { infoBarangRetur, rasioBayar } from './retur';
export type ReturnSource = {id:string;item_id:string|null;nama:string;qty:number;faktor:number|null;harga:number;satuan?:string|null};
export type PriorReturn = {source_line_id?:string|null;item_id:string|null;qty:number};
/** Return quantities remain base quantities; prices always belong to an exact source line. */
export function returnSourceRows(sources:ReturnSource[], prior:PriorReturn[]) {
 if(sources.some(s=>typeof s.id!=="string"||s.item_id===undefined||!Number.isFinite(Number(s.qty))||!Number.isFinite(Number(s.harga))||s.faktor===undefined)) throw new Error("Gagal memuat rincian sumber retur secara lengkap.");
 const used=new Map<string,number>();
 for(const p of prior){
  if(!p.item_id) continue;
  const matches=sources.filter(s=>s.item_id===p.item_id);
  const id=p.source_line_id ?? (matches.length===1 ? matches[0].id : null);
  if(!id) throw new Error('Retur lama belum memiliki sumber baris yang pasti — minta keuangan melakukan rekonsiliasi.');
  used.set(id,(used.get(id)??0)+Number(p.qty));
 }
 return sources.filter(s=>s.item_id).map(s=>{
  const factor=Number(s.faktor)||1;
  return {source_line_id:s.id,item_id:s.item_id!,nama:s.nama,source_qty:Number(s.qty),source_unit:s.satuan??"satuan sumber",sisa:Number(s.qty)*factor-(used.get(s.id)??0),harga:Number(s.harga)/factor};
 }).filter(r=>r.sisa>0);
}
export type ReturnFormRow = Omit<ReturnType<typeof returnSourceRows>[number], 'source_qty'|'source_unit'> & {source_qty?:number;source_unit?:string;
 units:ItemUnit[];berstok?:boolean;trackExpiry?:boolean;
 components?:{component_item_id:string|null;component_name:string;item_type:string;qty_per_group:number;unit:string}[];
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadSaleReturnRows(db:any, sale:{id:string;subtotal:number;total:number;sale_items:(ReturnSource & {sale_item_group_components?:ReturnFormRow['components']|null})[]|null}):Promise<ReturnFormRow[]> {
 const {data,error}=await db.from('sales_returns').select('sales_return_items(source_line_id,item_id,qty)').eq('sale_id',sale.id);
 if(error) throw new Error('Gagal memuat retur sebelumnya.');
 const sources=sale.sale_items??[];
 const rows=returnSourceRows(sources,(data??[]).flatMap((d:{sales_return_items:PriorReturn[]|null})=>d.sales_return_items??[]));
 const ids=sources.flatMap(s=>[s.item_id,...(s.sale_item_group_components??[]).map(c=>c.component_item_id)]).filter((id):id is string=>!!id);
 const [units,info]=await Promise.all([loadUnitOptions(db,ids,{includeInactive:true}),infoBarangRetur(db,ids)]);
 const ratio=rasioBayar(Number(sale.subtotal),Number(sale.total));
 return rows.map(r=>{
  const components=sources.find(s=>s.id===r.source_line_id)?.sale_item_group_components??[];
  const inventory=components.filter(c=>c.item_type==='Persediaan');
  const base=info.get(r.item_id);
  return {...r,harga:r.harga*ratio,units:units.get(r.item_id)??[],berstok:inventory.length>0||base?.berstok,trackExpiry:base?.trackExpiry||inventory.some(c=>!!info.get(c.component_item_id??'')?.trackExpiry),components};
 });
}
