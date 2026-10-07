"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {hariIniWIB} from "@/lib/tanggal";

export async function buatReturBeli(form:FormData) {
 const db=await createClient();
 const source=String(form.get("po_id")??"");
 const key=String(form.get("request_key")??"");
 const kasir=String(form.get("dari")??"")==="kasir";
 const back=kasir?"/kasir/retur":"/pembelian/retur/baru";
 const fail=(msg:string)=>redirect(`${back}?error=${encodeURIComponent(msg)}`);
 if(!source||!key) fail("Pilih sumber dan tunggu identitas simpan. Muat ulang bila diperlukan.");
 let items:unknown;
 try{items=JSON.parse(String(form.get("items")??"[]"));}catch{fail("Data barang tidak valid.");}
 const header={tanggal:String(form.get("tanggal")??"")||hariIniWIB(),keterangan:String(form.get("keterangan")??""),dari:String(form.get("dari")??""),lock_branch_id:String(form.get("lock_branch_id")??"")};
 const {data,error}=await db.rpc("post_unit_return",{p_kind:"purchase",p_source:source,p_request_key:key,p_header:header,p_items:items});
 if(error||!data) fail(error?.message??"Respons simpan belum terkonfirmasi. Periksa hasil transaksi terakhir sebelum menyimpan ulang.");
 revalidatePath("/pembelian/retur");
 const scope="purchase-return";
 redirect(`${back}?success=${encodeURIComponent(`Retur ${data.document_no} tersimpan.`)}&request_scope=${encodeURIComponent(scope)}&request_done=${encodeURIComponent(key)}`);
}
