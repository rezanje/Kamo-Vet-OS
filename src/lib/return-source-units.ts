import { type ItemUnit, loadUnitOptions } from './satuan';
import { infoBarangRetur, rasioBayar } from './retur';
export type ReturnSource = {id:string;item_id:string|null;nama:string;qty:number;faktor:number|null;harga:number;satuan?:string|null;pricing_version?:number|null;line_net_paid?:number|null};
export type PriorReturn = {source_line_id?:string|null;item_id:string|null;qty:number};
/** Return quantities remain base quantities; prices always belong to an exact source line. */
export function returnSourceRows(sources:ReturnSource[], prior:PriorReturn[]) {
 if(sources.some(s=>typeof s.id!=="string"||s.item_id===undefined||!Number.isFinite(Number(s.qty))||!Number.isFinite(Number(s.harga))||s.faktor===undefined)) throw new Error("Gagal memuat rincian sumber retur secara lengkap.");
 if(sources.some(s=>s.pricing_version!=null&&(s.pricing_version!==1||s.line_net_paid==null||!Number.isFinite(Number(s.line_net_paid))||Number(s.line_net_paid)<0||Number(s.qty)<=0||Number(s.faktor)<=0))) throw new Error('Snapshot harga neto sumber retur tidak lengkap.');
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
  return {source_line_id:s.id,item_id:s.item_id!,nama:s.nama,source_qty:Number(s.qty),source_unit:s.satuan??"satuan sumber",sisa:Number(s.qty)*factor-(used.get(s.id)??0),harga:s.pricing_version===1?Number(s.line_net_paid)/(Number(s.qty)*factor):Number(s.harga)/factor};
 }).filter(r=>r.sisa>0);
}
export type ReturnFormRow = Omit<ReturnType<typeof returnSourceRows>[number], 'source_qty'|'source_unit'> & {source_qty?:number;source_unit?:string;
 units:ItemUnit[];berstok?:boolean;trackExpiry?:boolean;
 components?:{component_item_id:string|null;component_name:string;item_type:string;qty_per_group:number;unit:string}[];
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadSaleReturnRows(db:any, sale:{id:string;subtotal:number;total:number;payment_plan?:unknown;sale_items:(ReturnSource & {sale_item_group_components?:ReturnFormRow['components']|null})[]|null}):Promise<ReturnFormRow[]> {
 const {data,error}=await db.from('sales_returns').select('sales_return_items(source_line_id,item_id,qty)').is("voided_at", null).eq('sale_id',sale.id);
 if(error) throw new Error('Gagal memuat retur sebelumnya.');
 const rawSources=sale.sale_items??[];
 type PricingSnapshot={sale_item_id:string;version:number;net_paid:number};
 const snapshots:PricingSnapshot[]=[];
 for(let from=0;;from+=1000){
  const {data:page,error:pricingError}=await db.from('sale_line_pricing')
   .select('sale_item_id,version,net_paid').eq('sale_id',sale.id).order('source_position').range(from,from+999);
  if(pricingError) throw new Error('Snapshot harga neto sumber retur gagal dimuat.');
  const batch=(page??[]) as PricingSnapshot[];
  snapshots.push(...batch);
  if(batch.length<1000) break;
 }
 const byLine=new Map(snapshots.map(s=>[s.sale_item_id,s]));
 if(snapshots.length&&(byLine.size!==rawSources.length||rawSources.some(s=>!byLine.has(s.id)))) throw new Error('Snapshot harga neto sumber retur tidak lengkap.');
 const sources=rawSources.map(s=>{
  const snapshot=byLine.get(s.id);
  return snapshot?{...s,pricing_version:snapshot.version,line_net_paid:Number(snapshot.net_paid)}:s;
 });
 const rows=returnSourceRows(sources,(data??[]).flatMap((d:{sales_return_items:PriorReturn[]|null})=>d.sales_return_items??[]));
 const ids=sources.flatMap(s=>[s.item_id,...(s.sale_item_group_components??[]).map(c=>c.component_item_id)]).filter((id):id is string=>!!id);
 const [units,info]=await Promise.all([loadUnitOptions(db,ids,{includeInactive:true}),infoBarangRetur(db,ids)]);
 const ratio=rasioBayar(Number(sale.subtotal),Number(sale.total),sale.payment_plan!=null);
 return rows.map(r=>{
  const components=sources.find(s=>s.id===r.source_line_id)?.sale_item_group_components??[];
  const inventory=components.filter(c=>c.item_type==='Persediaan');
  const base=info.get(r.item_id);
  return {...r,harga:byLine.has(r.source_line_id)?r.harga:r.harga*ratio,units:units.get(r.item_id)??[],berstok:inventory.length>0||base?.berstok,trackExpiry:base?.trackExpiry||inventory.some(c=>!!info.get(c.component_item_id??'')?.trackExpiry),components};
 });
}
