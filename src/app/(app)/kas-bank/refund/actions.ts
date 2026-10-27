"use server";
import {createClient} from '@/lib/supabase/server';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {transactionDraftAck} from '@/lib/transaction-draft-ack';
const BASE='/kas-bank/refund';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export async function processRefund(form:FormData){
 const fail=(message:string):never=>redirect(`${BASE}?error=${encodeURIComponent(message)}`);
 const id=String(form.get('id')??''),operation=String(form.get('operation')??'');
 // J03: clinic invoice refunds share the queue with their own RPCs.
 const clinic=form.get('kind')==='klinik',rpcName=(op:string)=>clinic?`${op}_clinic_refund_request`:`${op}_sales_refund_request`;
 if(!uuid(id)||!['claim','complete','cancel'].includes(operation))fail('Identitas proses refund tidak valid.');
 let rpc:string,args:Record<string,unknown>;
 if(operation==='claim'){rpc=rpcName('claim');args={p_id:id};}
 else if(operation==='complete'){
  if(form.get('payment_confirmed')!=='yes')fail('Beri konfirmasi transfer sudah dilakukan. Jangan mencatat transfer yang belum dibayar.');
  const tanggal=String(form.get('tanggal')??''),account=String(form.get('account_id')??''),reference=String(form.get('reference')??'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)||!uuid(account)||!reference||reference.length>120)fail('Isi tanggal, rekening sumber dan referensi transfer yang valid.');
  rpc=rpcName('complete');args={p_id:id,p_date:tanggal,p_account:account,p_reference:reference};
 }else{
  const reason=String(form.get('reason')??'').trim();
  if(form.get('unpaid_confirmed')!=='yes'||reason.length<3||reason.length>500)fail('Konfirmasi refund belum dibayar dan isi alasan pembatalan.');
  rpc=rpcName('cancel');args={p_id:id,p_reason:reason,p_unpaid_confirmed:true};
 }
 const db=await createClient();let response;
 try{response=await db.rpc(rpc,args);}catch{fail('Hasil proses belum terkonfirmasi. Muat ulang status sebelum mencoba pencatatan lagi. Jangan transfer ulang.');}
 if(!response)return fail('Hasil proses belum terkonfirmasi. Periksa status terakhir. Jangan transfer ulang.');
 if(response.error)fail(['P0001','42501','22023'].includes(response.error.code)?response.error.message:'Hasil proses belum terkonfirmasi. Muat ulang status. Jangan transfer ulang.');
 const result=response.data,expected=operation==='claim'?'diproses':operation==='complete'?'selesai':'batal';
 if(!result||result.refund_request_id!==id||result.status!==expected||(expected==='selesai'&&(!uuid(result.document_id)||typeof result.document_no!=='string'||!result.document_no.trim())))fail('Hasil proses belum terkonfirmasi. Periksa status terakhir. Jangan transfer ulang.');
 revalidatePath('/','layout');
 const message=expected==='selesai'?'Transfer dan retur terkonfirmasi. Bukti asal tetap tersimpan.':expected==='diproses'?'Refund diambil untuk diproses. Retur, stok dan jurnal belum diposting.':'Permintaan dibatalkan dengan konfirmasi belum dibayar; bukti tetap tersimpan.';
 redirect(`${BASE}?success=${encodeURIComponent(message)}${transactionDraftAck(form)}`);
}
