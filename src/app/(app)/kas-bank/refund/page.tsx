import Link from 'next/link';
import {createClient} from '@/lib/supabase/server';
import {readCompleteList} from '@/lib/checked-list';
import {hariIniWIB} from '@/lib/tanggal';
import {TransactionForm} from '@/components/LocalTransactionDraft';
import {SubmitButton} from '@/components/SubmitButton';
import {processRefund} from './actions';
type Row={id:string;sale_id:string;source_ref:string;branch_id:string;requested_by:string;status:'pending'|'diproses'|'selesai'|'batal';quoted_total:number;destination:{bank:string;account:string;name:string}|null;requested_date:string;created_at:string;processed_by:string|null;return_id:string|null};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function readRows(value:unknown):Row[]{
 if(!Array.isArray(value)||value.length>100)throw Error('Antrean refund belum dapat diperiksa. Muat ulang.');
 const ids=new Set();
 return value.map((v:Row)=>{
  if(!v||!uuid(v.id)||!uuid(v.sale_id)||typeof v.source_ref!=='string'||typeof v.branch_id!=='string'||!['pending','diproses','selesai','batal'].includes(v.status)||!Number.isFinite(v.quoted_total)||v.quoted_total<=0||ids.has(v.id)||typeof v.created_at!=='string'||typeof v.requested_date!=='string'||(v.return_id!==null&&!uuid(v.return_id))||(v.destination!==null&&(!v.destination||!['bank','account','name'].every(k=>typeof v.destination?.[k as keyof typeof v.destination]==='string'))))throw Error('Antrean refund belum dapat diperiksa. Muat ulang.');
  ids.add(v.id);return v;
 });
}
export default async function RefundPage({searchParams}:{searchParams:Promise<{status?:string;offset?:string;error?:string;success?:string}>}){
 const params=await searchParams,db=await createClient();
 const {data:{user}}=await db.auth.getUser();if(!user)throw Error('Akses refund memerlukan sesi aktif.');
 const {data:profile,error:profileError}=await db.from('profiles').select('role,is_active').eq('id',user.id).maybeSingle();
 if(profileError||!profile?.is_active||!['OWNER','ADMIN','FINANCE'].includes(profile.role))throw Error('Akses antrean refund hanya untuk finance berwenang.');
 const status=params.status??'',offset=Number(params.offset??0);
 if(!['','pending','diproses','selesai','batal'].includes(status)||!Number.isInteger(offset)||offset<0||offset>100000)throw Error('Filter antrean refund tidak valid.');
 const [result,banks]=await Promise.all([
  db.rpc('get_sales_refund_requests',{p_sale_id:null,p_office:true,p_status:status,p_offset:offset}),
  readCompleteList<{id:string;nama:string;branch_id:string|null}>((from,to)=>db.from('cash_accounts').select('id,nama,branch_id',{count:'exact'}).eq('is_active',true).eq('jenis','Bank').order('nama').order('id').range(from,to),'Rekening sumber refund',{maxRows:null}),
 ]);
 if(result.error)throw Error('Antrean refund belum dapat dimuat. Muat ulang tanpa mengulang transfer.');
 const rows=readRows(result.data),page=(n:number)=>`/kas-bank/refund?status=${encodeURIComponent(status)}&offset=${n}`;
 return <>
  <Link className="back-btn" href="/kas-bank">Kembali ke Kas &amp; Bank</Link><h2>Antrean refund transfer</h2>
  <p>Ambil proses sebelum melakukan transfer. Ini pencatatan pembayaran manual; aplikasi tidak mengirim uang ke bank. Permintaan pending/diproses: retur, stok dan jurnal belum diposting.</p>
  {params.error&&<p role="alert">{params.error}</p>}{params.success&&<p role="status">{params.success}</p>}
  <form method="get"><label>Status <select name="status" defaultValue={status}><option value="">Semua</option>{['pending','diproses','selesai','batal'].map(s=><option key={s} value={s}>{s}</option>)}</select></label><button type="submit" className="btn-def">Tampilkan</button></form>
  {!rows.length&&<p>Belum ada permintaan pada halaman ini.</p>}
  {rows.map(row=><section className="crm-sec" key={row.id} style={{overflowWrap:'anywhere'}}>
   <h3><Link href={`/penjualan/${row.sale_id}`}>{row.source_ref}</Link> · {row.status}</h3><small>ID permintaan: {row.id}</small>
   <p>Rp {row.quoted_total.toLocaleString('id-ID',{maximumFractionDigits:2})} · Tanggal permintaan {row.requested_date}</p>
   {row.destination&&<p>Tujuan: {row.destination.bank} · {row.destination.account} · {row.destination.name}</p>}
   {row.return_id&&<p><Link href={`/penjualan/retur/${row.return_id}`}>Lihat retur dan jurnal asal</Link></p>}
   {row.status==='pending'&&<TransactionForm userId={user.id} scope={`refund-claim:${row.id}`} action={processRefund}><input type="hidden" name="id" value={row.id}/><input type="hidden" name="operation" value="claim"/><SubmitButton className="btn-acc" pendingText="Memeriksa…">Ambil proses</SubmitButton></TransactionForm>}
   {row.status==='diproses'&&row.processed_by!==user.id&&<p>Sedang ditangani petugas lain. Hubungi pemroses sebelum pembatalan; jangan transfer ulang.</p>}
   {row.status==='diproses'&&row.processed_by===user.id&&<TransactionForm userId={user.id} scope={`refund-complete:${row.id}`} action={processRefund}>
    <input type="hidden" name="id" value={row.id}/><input type="hidden" name="operation" value="complete"/>
    <div style={{display:'flex',gap:10,flexWrap:'wrap'}}><label>Tanggal transfer <input className="fi" name="tanggal" type="date" required min={row.requested_date} max={hariIniWIB()} defaultValue={hariIniWIB()}/></label>
    <label>Rekening sumber <select className="fi" name="account_id" required defaultValue=""><option value="">Pilih rekening bank</option>{banks.filter(b=>b.branch_id===null||b.branch_id===row.branch_id).map(b=><option key={b.id} value={b.id}>{b.nama}</option>)}</select></label>
    <label>Referensi transfer <input className="fi" name="reference" required maxLength={120}/></label></div>
    <p><label><input type="checkbox" name="payment_confirmed" value="yes" required/> Saya pastikan transfer sudah dilakukan tepat satu kali ke tujuan di atas.</label></p>
    <SubmitButton className="btn-acc" pendingText="Memeriksa bukti…">Catat transfer selesai &amp; posting retur</SubmitButton>
   </TransactionForm>}
   {['pending','diproses'].includes(row.status)&&<details><summary>Batalkan permintaan yang belum dibayar</summary><TransactionForm userId={user.id} scope={`refund-cancel:${row.id}`} action={processRefund}>
    <input type="hidden" name="id" value={row.id}/><input type="hidden" name="operation" value="cancel"/><label>Alasan <input className="fi" name="reason" required minLength={3} maxLength={500}/></label>
    <p><label><input type="checkbox" name="unpaid_confirmed" value="yes" required/> Refund ini belum dibayar.</label></p><SubmitButton className="btn-def" pendingText="Memeriksa…">Batalkan permintaan</SubmitButton>
   </TransactionForm></details>}
  </section>)}
  <nav style={{display:'flex',gap:12}}>{offset>0&&<Link href={page(Math.max(0,offset-100))}>Sebelumnya</Link>}{rows.length===100&&<Link href={page(offset+100)}>Berikutnya</Link>}</nav>
 </>;
}
