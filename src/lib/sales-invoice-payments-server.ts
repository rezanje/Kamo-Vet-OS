import type {SupabaseClient}from '@supabase/supabase-js';
import{ListLoadError,readCompleteList}from './checked-list';
type Child={id:string;invoice_id:string};
type Receipt=Child&{jumlah:number};
type Payment=Child&{amount:number};
async function readChildren<T extends Child>(ids:string[],load:(batch:string[])=>Promise<T[]>,label:string){
 const grouped=new Map<string,T[]>(),seen=new Set<string>();
 const sourceIds=[...new Set(ids)];
 for(let start=0;start<sourceIds.length;start+=200){
  const batch=sourceIds.slice(start,start+200),allowed=new Set(batch);
  for(const row of await load(batch)){
   if(!allowed.has(row.invoice_id)||seen.has(row.id))throw new ListLoadError(`${label}: identitas sumber berubah saat dimuat. Coba muat ulang.`);
   seen.add(row.id);const list=grouped.get(row.invoice_id)??[];list.push(row);grouped.set(row.invoice_id,list);
  }
 }
 return grouped;
}
/** Separate checked child reads prevent capped embedded payments from understating paid totals. */
export async function loadSalesInvoicePayments(client:SupabaseClient,wholesaleIds:string[],clinicIds:string[]){
 const[receipts,payments]=await Promise.all([
  readChildren(wholesaleIds,batch=>readCompleteList<Receipt>((from,to)=>client.from('sales_receipts')
   .select('id,invoice_id,jumlah',{count:'exact'}).in('invoice_id',batch).order('id').range(from,to),'Penerimaan faktur penjualan',{maxRows:null}),'Penerimaan faktur penjualan'),
  readChildren(clinicIds,batch=>readCompleteList<Payment>((from,to)=>client.from('invoice_payments')
   .select('id,invoice_id,amount',{count:'exact'}).in('invoice_id',batch).order('id').range(from,to),'Pembayaran faktur klinik',{maxRows:null}),'Pembayaran faktur klinik'),
 ]);
 return{receipts,payments};
}
