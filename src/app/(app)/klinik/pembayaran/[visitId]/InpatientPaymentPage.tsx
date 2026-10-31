import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Popup } from "@/components/Popup";
import type { createClient } from "@/lib/supabase/server";
import { loadClinicPaymentMaster } from "@/lib/clinic-payment";

import { getDpMinimalPercent, bolehMenerobosDp } from "@/lib/dp-minimal";
import { bolehSiklusTagihan } from "@/lib/uang-tagihan";
import type { InpatientCashierData, InpatientCashierReadOnly } from "@/lib/inpatient-cashier";
import { PaymentPageHeading, PaymentPatientHeader, type PaymentPatient } from "./PaymentPresentation";
import { InpatientCashier } from "./InpatientCashier";
const rp=(n:number)=>`Rp ${Math.round(n).toLocaleString("id-ID")}`;
type Query={error?:string;success?:string;invoice?:string;receipt?:string;applications?:string};
export async function InpatientPaymentPage({db,visitId,recordId,branchId,userId,query,patient,catatanResep = null,stayStatus}: {
 db:Awaited<ReturnType<typeof createClient>>;visitId:string;recordId:string;branchId:string|null;userId:string;query:Query;
 patient:PaymentPatient;catatanResep?:string|null;stayStatus?:string;
}) {
 const [read,master,minDpPercent,profile]=await Promise.all([
  db.rpc("clinic_read_inpatient_cashier",{p_record_id:recordId,p_visit_id:visitId}),loadClinicPaymentMaster(db,branchId),getDpMinimalPercent(db),
  db.from("profiles").select("role,full_name").eq("id",userId).maybeSingle(),
 ]);
 const data=read.data as InpatientCashierData|InpatientCashierReadOnly|null;
 const editable=data?.state==="SHIFT_REQUIRED"?null:data;
 if(read.error||!data||!Array.isArray(data.history)||!Array.isArray(data.receipts)||!Array.isArray(data.applications)||
  (editable ? typeof editable.snapshot!=="string"||!Array.isArray(editable.rows)||!editable.quote||!Array.isArray(editable.quote.accounts)||!editable.tax_settings||typeof editable.tax_settings.mode_pkp!=="boolean"||!Number.isFinite(Number(editable.tax_settings.ppn_rate))||Number(editable.tax_settings.ppn_rate)<0||Number(editable.tax_settings.ppn_rate)>100 : data.quote!==null||data.snapshot!==null))return <section className="card" role="alert">Tagihan rawat inap belum dapat diverifikasi. Muat ulang sebelum memproses uang.</section>;
 const savedInvoice=query.invoice?data.history.find(i=>i.id===query.invoice&&!i.correction_pending):null;
 const savedReceipt=query.receipt?data.receipts.find(r=>r.id===query.receipt&&r.status==="aktif"):null;
 const ids=query.applications?.split(",")??[];
 const savedApplications=ids.length>0&&ids.length<=200&&new Set(ids).size===ids.length&&ids.every(id=>data.applications.some(a=>a.id===id&&Number(a.amount)>0&&!a.released_at&&data.history.some(i=>i.id===a.invoice_id&&!i.correction_pending)));
 const saved=query.success==="transaksi"&&(!query.invoice||!!savedInvoice)&&(!query.receipt||!!savedReceipt)&&(!query.applications||savedApplications)&&!!(savedInvoice||savedReceipt||savedApplications);
 const settled=editable&&editable.quote.remaining===0&&editable.rows.length===0&&!data.history.some(i=>i.correction_pending);
 return <>
  <Link className="back-btn" href="/klinik/rawat-inap">Status Rawat Inap</Link>
  <PaymentPageHeading />
  {stayStatus&&<div style={{fontSize:11,color:"var(--tm)",marginBottom:12}}>{stayStatus}</div>}
  <Popup message={query.error}/>
  {editable&&!query.error&&saved&&<Popup tone="success" title={settled&&data.history.length?"Pembayaran lunas":savedApplications?"Saldo pemilik diterapkan":savedReceipt?"Pembayaran diterima":"Transaksi tersimpan"} message={`${savedInvoice?.invoice_no??savedReceipt?.no_kwitansi??"Pemakaian saldo pemilik"} · Sisa pembayaran ${rp(editable.quote.remaining)}`}/>}
  {editable?<InpatientCashier key={editable.snapshot} data={editable} visitId={visitId} recordId={recordId} requestKey={randomUUID()} patient={patient} catatanResep={catatanResep} cashierName={profile.data?.full_name??"Akun kasir"} masterObat={master.obat} masterJasa={master.jasa}
   ppnRate={editable.tax_settings.mode_pkp?Number(editable.tax_settings.ppn_rate):0} minDpPercent={minDpPercent} bolehTerobos={bolehMenerobosDp(profile.data?.role??null)}/>:<><PaymentPatientHeader patient={patient}/><section className="card" role="status">Riwayat tetap dapat dibaca. Buka shift klinik milik Anda sebelum mengubah keranjang atau memproses pembayaran. <Link href="/klinik/shift">Buka shift</Link></section></>}
  <section className="card" style={{marginTop:12}}><h2 style={{fontSize:16}}>INVOICE / RIWAYAT TAHAP · BACA SAJA</h2>
   <p>Setiap pilihan membuka invoice yang benar-benar diterbitkan, bukan nomor invoice gabungan baru.</p>
   {data.history.map(invoice=><details key={invoice.id} style={{marginBottom:10}}><summary><b>{invoice.invoice_no}</b> · {invoice.paid_status} · Total {rp(invoice.total)} · Dibayar {rp(invoice.received)} · Sisa {rp(Math.max(0,invoice.total-invoice.received))} <Link href={`/klinik/pembayaran/${visitId}/invoice?invoice_id=${invoice.id}`} className="btn-acc">Cetak Invoice {invoice.invoice_no}</Link></summary>
    {editable&&bolehSiklusTagihan(profile.data?.role??null)&&<Link href={`/klinik/pembayaran/${visitId}?invoice_id=${invoice.id}`}>Kelola dokumen ini (alur koreksi terpisah)</Link>}
    {Number(invoice.dp_amount)>0&&<p>DP awal tersimpan: {rp(Number(invoice.dp_amount))} (bukan penerimaan baru)</p>}
    <table className="tbl"><thead><tr><th>Item</th><th>Qty</th><th>Harga</th></tr></thead><tbody>{invoice.lines.map(line=><tr key={line.id}><td>{line.deskripsi}</td><td>{line.qty}</td><td>{rp(Number(line.harga))}</td></tr>)}</tbody></table>
   </details>)}
   {!data.history.length&&<p>Belum ada invoice terbit. Saldo pemilik saja bukan invoice penjualan.</p>}
  </section>
  <details className="card" style={{marginTop:12}}><summary>Riwayat penerimaan / bukti uang muka (sekunder)</summary>
   {data.receipts.map(receipt=><div key={receipt.id}>{receipt.no_kwitansi} · {rp(receipt.total)} · {receipt.status} · {receipt.parts.map(part=>`${part.metode} ${rp(Number(part.amount))}`).join(" + ")} <Link href={`/klinik/rawat-inap/${recordId}/tagihan/kwitansi/${receipt.id}`}>Bukti penerimaan</Link></div>)}
   <Link href={`/klinik/rawat-inap/${recordId}/tagihan`}>Riwayat lengkap / pembatalan penerimaan</Link>
  </details>
 </>;
}
