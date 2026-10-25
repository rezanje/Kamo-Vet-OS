import { servicePerformerNames } from "@/lib/service-performers";
import Link from 'next/link';
import type { InpatientHandoff, HandoffInvoice } from '@/lib/inpatient-handoff';
const RECIPE_STATUS:Record<string,string>={pending:'Menunggu diracik',ready:'Siap diserahkan',handed_over:'Diserahkan oleh farmasi',void:'Racikan dibatalkan'};
function recorded(when:string,admittedAt:string){
 const time=Date.parse(when),admitted=Date.parse(admittedAt);
 if(!Number.isFinite(time))return 'Waktu pencatatan tidak tersedia';
 const date=new Date(time).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'});
 return `${date} WIB${Number.isFinite(admitted)?time<admitted?' · Dicatat sebelum masuk rawat inap':' · Dicatat pada/setelah masuk rawat inap':''}`;
}
function InvoiceTag({invoice,qty}:{invoice:HandoffInvoice;qty?:number}){
 return <span className="back-btn" style={{fontSize:11,whiteSpace:'normal',overflowWrap:'anywhere'}}>{invoice.invoice_no??'Nomor faktur tidak tersedia'} · {invoice.voided_at?'Dibatalkan':invoice.paid_status||'Status belum tersedia'}{qty!==undefined?` · qty faktur ${qty}`:''}</span>;
}
export function HandoffPanel({data,visitId,admittedAt}:{data:InpatientHandoff|null;visitId:string;admittedAt:string}){
 if(!data)return <section className="crm-sec" data-inpatient-handoff><h2 style={{fontSize:15}}>Ringkasan konsultasi dan resep</h2><p role="alert">Ringkasan belum dapat dimuat lengkap. Muat ulang atau periksa rekam medis asal sebelum melanjutkan perawatan.</p></section>;
 const invoiceById=new Map(data.invoices.map(row=>[row.id,row]));
 function billing(prescriptionId:string|null,recipeId:string|null){
  const rows=data!.invoiceLines.filter(line=>(prescriptionId!==null&&line.prescription_item_id===prescriptionId)||(recipeId!==null&&line.compound_recipe_id===recipeId));
  return rows.length?<div style={{display:'flex',gap:5,flexWrap:'wrap'}}>{rows.map(line=>{const invoice=invoiceById.get(line.invoice_id);return invoice?<InvoiceTag key={line.id} invoice={invoice} qty={line.qty}/>:<span key={line.id}>Faktur tidak tersedia</span>;})}</div>:<span>Belum ada tautan tagihan per baris</span>;
 }
 return <section className="crm-sec" data-inpatient-handoff style={{minWidth:0,overflowWrap:'anywhere'}}>
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}><h2 style={{fontSize:15}}>Ringkasan konsultasi dan resep</h2><Link className="back-btn" href={`/klinik/rekam-medis/${encodeURIComponent(visitId)}`}>Buka rekam medis asal</Link></div>
  <p style={{fontSize:12}}>Dokter kunjungan: <b>{data.doctor??'Belum tercatat'}</b>. Data tersimpan saat ini pada kunjungan yang sama; tambahan selama rawat inap ikut ditampilkan.</p>
  <p style={{whiteSpace:'pre-wrap'}}><b>Keluhan awal kunjungan:</b> {data.complaint||'Belum tercatat'}</p>
  {data.records.map(record=><article key={record.id} style={{borderTop:'1px solid var(--bd)',paddingTop:10,marginTop:10}}>
   <p style={{fontSize:11,color:'var(--tm)'}}>{recorded(record.created_at,admittedAt)}</p>
   <div className="grid2"><div><b>Anamnesis / catatan konsultasi</b><p style={{whiteSpace:'pre-wrap'}}>{record.anamnesis||'Belum tercatat'}</p></div><div><b>Diagnosis tercatat</b><p style={{whiteSpace:'pre-wrap'}}>{record.diagnosis||'Belum tercatat'}</p></div></div>
   {record.catatan_resep&&<p style={{whiteSpace:'pre-wrap'}}>Catatan resep: {record.catatan_resep}</p>}
  </article>)}
  {!data.records.length&&<p>Belum ada rekam medis tersimpan untuk kunjungan ini.</p>}
  <h3 style={{fontSize:13}}>Obat dan tindakan dalam resep</h3>
  <div style={{overflowX:'auto'}}><table className="tbl" style={{minWidth:620}}><thead><tr><th>Obat / tindakan</th><th>Jumlah &amp; aturan pakai</th><th>Tautan tagihan</th></tr></thead><tbody>{data.prescriptions.map(row=><tr key={row.id}><td>{row.nama_obat}{row.jenis === "jasa" && <div style={{fontSize:11}}>{servicePerformerNames(row.service_performers).join(" · ")}</div>}<div style={{fontSize:11,color:'var(--tm)'}}>{row.jenis} · {recorded(row.created_at,admittedAt)}</div></td><td>{row.qty} {row.satuan??''}<div style={{whiteSpace:'pre-wrap'}}>{row.aturan_pakai||'Aturan pakai belum tercatat'}</div></td><td>{billing(row.id,row.compound_recipe_id)}</td></tr>)}{!data.prescriptions.length&&<tr><td colSpan={3}>Belum ada obat/tindakan dalam resep tersimpan.</td></tr>}</tbody></table></div>
  <h3 style={{fontSize:13}}>Racikan dan status farmasi</h3>
  {data.recipes.map(row=><article key={row.id} style={{border:'1px solid var(--bd)',borderRadius:7,padding:10,marginTop:8}}><Link className="back-btn" href={`/klinik/racik/${encodeURIComponent(row.id)}`}>{row.recipe_name} · Buka racikan</Link><p>{row.total_volume} · {row.dosage_form} · {RECIPE_STATUS[row.status]??'Status belum dikenali'}</p><p style={{whiteSpace:'pre-wrap'}}>Aturan pakai: {row.dosage_instruction||'Belum tercatat'}</p><p style={{fontSize:11}}>{recorded(row.created_at,admittedAt)}</p>{billing(null,row.id)}</article>)}
  {!data.recipes.length&&<p>Belum ada racikan tersimpan untuk kunjungan ini.</p>}
  <p style={{fontSize:12}}>Status resep, penyerahan farmasi dan pembayaran bukan bukti obat sudah diberikan kepada pasien. Catatan pemberian obat berprotokol berada pada <a href="#obat-khusus">Obat Khusus</a>. Penyerahan obat biasa belum memiliki bukti per resep pada ringkasan ini.</p>
  <details><summary>Faktur kunjungan dan batas informasi pembayaran</summary><div style={{display:'flex',gap:5,flexWrap:'wrap',marginTop:8}}>{data.invoices.map(invoice=><InvoiceTag key={invoice.id} invoice={invoice}/>)}</div>{!data.invoices.length&&<p>Belum ada faktur tersimpan untuk kunjungan ini.</p>}<p><Link className="back-btn" href={`/klinik/pembayaran/${encodeURIComponent(visitId)}`}>Buka pembayaran kunjungan</Link></p><p>Faktur tanpa tautan per baris tidak dipasangkan ke obat/tindakan. Status dan qty faktur ditampilkan sesuai dokumen asal.</p><p>Lama inap terbayar belum dapat dipastikan. Periksa rincian tagihan; tanggal masuk bukan bukti pembayaran durasi rawat inap.</p></details>
 </section>;
}
