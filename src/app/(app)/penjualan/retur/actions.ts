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
 let items:unknown;
 try{items=JSON.parse(String(form.get("items")??"[]"));}catch{fail("Data barang tidak valid.");}
 const header={tanggal:String(form.get("tanggal")??"")||hariIniWIB(),keterangan:String(form.get("keterangan")??""),dari:String(form.get("dari")??""),lock_branch_id:String(form.get("lock_branch_id")??"")};
 const {data,error}=await db.rpc("post_unit_return",{p_kind:"sales",p_source:source,p_request_key:key,p_header:header,p_items:items});
 if(error||!data) fail(error?.message??"Respons simpan belum terkonfirmasi. Periksa hasil transaksi terakhir sebelum menyimpan ulang.");
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(typeof data.document_id!=="string"||!uuid.test(data.document_id)||typeof data.document_no!=="string"||!data.document_no.trim())return fail("Respons retur belum terkonfirmasi. Periksa hasil terakhir sebelum membuat retur lain.");
 let spendingWarning="";
 try{
  const result=await db.from("sales_returns").select("sale_id,sales(customer_id)").eq("id",data.document_id).maybeSingle();
  const origin=Array.isArray(result.data?.sales)?result.data.sales[0]:result.data?.sales;
  if(result.error||!result.data||result.data.sale_id!==source||!origin)throw Error("Sumber pelanggan belum terbaca");
  if(origin.customer_id && !await recomputeCustomerTier(db,origin.customer_id))throw Error("Nilai pelanggan belum diperbarui");
 }catch{
  // The atomic return already committed. A derived-customer failure must not
  // be presented as a failed return or lose the receipt/draft acknowledgement.
  spendingWarning=" Namun nilai belanja pelanggan belum diperbarui. Muat ulang profil dan periksa sumber; jangan membuat retur ulang.";
 }
 revalidatePath("/penjualan/retur");
 revalidatePath("/crm/pelanggan");
 revalidatePath("/kasir");
 const scope="sales-return:"+source;
 redirect(`${back}?${query}&success=${encodeURIComponent(`Retur ${data.document_no} tersimpan.${spendingWarning}`)}&request_scope=${encodeURIComponent(scope)}&request_done=${encodeURIComponent(key)}`);
}
