"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {recomputeCustomerTier} from "@/lib/customer-tier";
import {hariIniWIB} from "@/lib/tanggal";

export async function buatReturJual(form:FormData) {
 const db=await createClient();
 const source=String(form.get("sale_id")??"");
 const key=String(form.get("request_key")??"");
 const kasir=String(form.get("dari")??"")==="kasir";
 const back=kasir?"/kasir/retur":"/penjualan/retur/baru";
 const query="struk="+encodeURIComponent(String(form.get("source_ref")??""));
 const fail=(msg:string)=>redirect(`${back}?${query}&error=${encodeURIComponent(msg)}`);
 if(!source||!key) fail("Pilih sumber dan tunggu identitas simpan. Muat ulang bila diperlukan.");
 let response;
 if(form.get('tindakan')==='periksa'){
  try{response=await db.rpc('get_sales_refund_result',{p_request_key:key});}catch{fail('Hasil refund belum terkonfirmasi. Tidak ada posting baru.');}
 }else{
  let items:unknown;try{items=JSON.parse(String(form.get("items")??"[]"));}catch{fail("Data barang tidak valid.");}
  if(!Array.isArray(items)||items.length===0||items.length>100)fail('Isi rincian retur yang valid.');
  const method=String(form.get('refund_method')??'');if(!['Tunai','Transfer'].includes(method))fail('Pilih payout Tunai atau Transfer.');
  const header={tanggal:String(form.get("tanggal")??"")||hariIniWIB(),keterangan:String(form.get("keterangan")??""),dari:String(form.get("dari")??""),refund_method:method,
   destination:method==='Transfer'?{bank:String(form.get('refund_bank')??'').trim(),account:String(form.get('refund_account')??'').trim(),name:String(form.get('refund_name')??'').trim()}:null};
  try{response=await db.rpc('post_sales_return_with_payout',{p_source:source,p_request_key:key,p_header:header,p_items:items});}catch{fail('Respons refund belum terkonfirmasi. Periksa hasil terakhir sebelum mencoba lagi.');}
 }
 if(!response)return fail('Hasil refund belum terkonfirmasi. Periksa daftar sebelum mencoba lagi.');
 const {data,error}=response;
 if(error)fail(['P0001','42501','22023'].includes(error.code)?error.message:'Respons refund belum terkonfirmasi. Periksa hasil terakhir.');
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!data||!uuid.test(data.refund_request_id)||!['pending','diproses','selesai'].includes(data.status)
  ||(data.status==='selesai'&&(!uuid.test(data.document_id)||typeof data.document_no!=='string'||!data.document_no.trim()))
  ||(data.status!=='selesai'&&(typeof data.quoted_total!=='number'||!Number.isFinite(data.quoted_total)||data.quoted_total<=0)))fail('Hasil refund belum terkonfirmasi. Periksa daftar sebelum mencoba lagi.');
 let spendingWarning="";
 if(data.status==='selesai')try{
  const result=await db.from("sales_returns").select("sale_id,sales(customer_id)").eq("id",data.document_id).maybeSingle();
  const origin=Array.isArray(result.data?.sales)?result.data.sales[0]:result.data?.sales;
  if(result.error||!result.data||result.data.sale_id!==source||!origin)throw Error("Sumber pelanggan belum terbaca");
  if(origin.customer_id && !await recomputeCustomerTier(db,origin.customer_id))throw Error("Nilai pelanggan belum diperbarui");
 }catch{
  // The atomic return already committed. A derived-customer failure must not
  // be presented as a failed return or lose the receipt/draft acknowledgement.
  spendingWarning=" Namun nilai belanja pelanggan belum diperbarui. Muat ulang profil dan periksa sumber; jangan membuat retur ulang.";
 }
 revalidatePath('/','layout');
 const scope="sales-return:"+source;
 const message=data.status==='selesai'?`Retur ${data.document_no} dan payout terkonfirmasi.`:`Permintaan refund ${data.status==='pending'?'diterima':'sedang diproses finance'}; retur, stok dan jurnal belum diposting. Jangan membuat permintaan pengganti untuk transaksi yang sama.`;
 redirect(`${back}?${query}&success=${encodeURIComponent(message+spendingWarning)}&request_scope=${encodeURIComponent(scope)}&request_done=${encodeURIComponent(key)}`);
}
export async function recoverReturJual(form:FormData){form.set('tindakan','periksa');return buatReturJual(form);}
