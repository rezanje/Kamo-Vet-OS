import type{ReactNode}from'react';
import Link from'next/link';
import{createClient}from'@/lib/supabase/server';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
type Row={id:string;status:string;quoted_total:number;return_id:string|null};
export async function RefundSourcePanel({saleId,children}:{saleId:string;children:ReactNode}){
 const unavailable=<p role="alert">Status permintaan refund belum dapat diperiksa. Muat ulang sebelum membuat permintaan baru; jangan membayar ulang.</p>;
 let result;try{const db=await createClient();result=await db.rpc('get_sales_refund_requests',{p_sale_id:saleId,p_office:false,p_status:'',p_offset:0});}catch{return unavailable;}
 if(!result||result.error||!Array.isArray(result.data)||result.data.length>=100)return unavailable;
 const ids=new Set();
 if(result.data.some((r:Row)=>{
  if(!r||!uuid(r.id)||ids.has(r.id)||!['pending','diproses','selesai','batal'].includes(r.status)||!Number.isFinite(r.quoted_total)||r.quoted_total<=0||(r.return_id!==null&&!uuid(r.return_id)))return true;
  ids.add(r.id);return false;
 }))return unavailable;
 return <>
  {result.data.length>0&&<section className="crm-sec"><h3>Permintaan refund akun ini</h3><p>Permintaan pending/diproses: retur, stok dan jurnal belum diposting. Periksa permintaan ini sebelum mengajukan lagi; jangan membayar ulang.</p>
   <ul>{result.data.map((r:Row)=><li key={r.id} style={{overflowWrap:'anywhere'}}>{r.status} · Rp {r.quoted_total.toLocaleString('id-ID',{maximumFractionDigits:2})} · {r.id}{r.return_id&&<> · <Link href={`/penjualan/retur/${r.return_id}`}>Lihat retur</Link></>}</li>)}</ul>
  </section>}
  {children}
 </>;
}
