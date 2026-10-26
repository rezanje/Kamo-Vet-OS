import { servicePerformerNames } from "@/lib/service-performers";
import Link from 'next/link';
import { handoffSourceStatus, isRegularDrug, type InpatientHandoff, type HandoffInvoice } from '@/lib/inpatient-handoff';
import { ObatBiasaEvidence } from './ObatBiasaEvidence';
function recorded(when:string,admittedAt:string){
 const time=Date.parse(when),admitted=Date.parse(admittedAt);
 if(!Number.isFinite(time))return 'Waktu pencatatan tidak tersedia';
 const date=new Date(time).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'});
 return `${date} WIB${Number.isFinite(admitted)?time<admitted?' · Dicatat sebelum masuk rawat inap':' · Dicatat pada/setelah masuk rawat inap':''}`;
}
function InvoiceTag({invoice,qty}:{invoice:HandoffInvoice;qty?:number}){
 return <span className="back-btn" style={{fontSize:11,whiteSpace:'normal',overflowWrap:'anywhere'}}>{invoice.invoice_no??'Nomor faktur tidak tersedia'} · {invoice.voided_at?'Dibatalkan':invoice.paid_status||'Status belum tersedia'}{qty!==undefined?` · qty faktur ${qty}`:''}</span>;
}
/** recordId/active are optional wiring from the page: without them evidence is read-only (no forms). */
export function HandoffPanel({data,visitId,admittedAt,recordId,active}:{data:InpatientHandoff|null;visitId:string;admittedAt:string;recordId?:string;active?:boolean}){
 if(!data)return <section className="crm-sec" data-inpatient-handoff><h2 style={{fontSize:15}}>Ringkasan konsultasi dan resep</h2><p role="alert">Ringkasan belum dapat dimuat lengkap. Muat ulang atau periksa rekam medis asal sebelum melanjutkan perawatan.</p></section>;
 const sourceStatus=handoffSourceStatus(data);
 const sourceByKey=new Map(sourceStatus.rows.map(row=>[row.key,row]));
 const regularDrugs=data.prescriptions.filter(isRegularDrug);
 const evidence=data.evidence;
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
  <h3 style={{fontSize:13}}>Status sumber per baris</h3>
  <p style={{fontSize:12}}>Diresepkan, ditagih, status faktur, diserahkan, dan diberikan adalah bukti yang berbeda. Pembayaran faktur tidak dialokasikan ke obat/tindakan tertentu.</p>
  <div style={{overflowX:'auto'}}><table className="tbl" style={{minWidth:920}}><thead><tr><th>Obat / tindakan</th><th>Diresepkan / aturan pakai</th><th>Ditagih</th><th>Status faktur</th><th>Diserahkan</th><th>Diberikan</th></tr></thead><tbody>{data.prescriptions.map(row=>{const status=sourceByKey.get(`rx:${row.id}`);return <tr key={row.id}><td>{row.nama_obat}{row.jenis === "jasa" && <div style={{fontSize:11}}>{servicePerformerNames(row.service_performers).join(" · ")}</div>}<div style={{fontSize:11,color:'var(--tm)'}}>{row.jenis} · {recorded(row.created_at,admittedAt)}</div></td><td>{row.qty} {row.satuan??''}<div style={{whiteSpace:'pre-wrap'}}>{row.aturan_pakai||'Aturan pakai belum tercatat'}</div></td><td>{status?.billing}{status?.duplicateActiveInvoices&&<div role="alert">Tertaut ke lebih dari satu faktur aktif. Periksa sebelum menagih ulang.</div>}</td><td>{status?.payment}</td><td>{status?.handover}</td><td>{status?.administration}</td></tr>})}{!data.prescriptions.length&&<tr><td colSpan={6}>Belum ada obat/tindakan dalam resep tersimpan.</td></tr>}</tbody></table></div>
  <h3 style={{fontSize:13}}>Racikan dan status farmasi</h3>
  {data.recipes.map(row=>{const status=sourceByKey.get(`recipe:${row.id}`);return <article key={row.id} style={{border:'1px solid var(--bd)',borderRadius:7,padding:10,marginTop:8}}><Link className="back-btn" href={`/klinik/racik/${encodeURIComponent(row.id)}`}>{row.recipe_name} · Buka racikan</Link><p>{row.total_volume} · {row.dosage_form} · {status?.handover??'Status belum dikenali'}</p><p style={{whiteSpace:'pre-wrap'}}>Aturan pakai: {row.dosage_instruction||'Belum tercatat'}</p><p style={{fontSize:11}}>{recorded(row.created_at,admittedAt)}</p>{status&&<p>Tagihan: {status.billing}. Status faktur: {status.payment}. Pemberian: {status.administration}.</p>}</article>})}
  {!data.recipes.length&&<p>Belum ada racikan tersimpan untuk kunjungan ini.</p>}
  <h3 id="bukti-obat-biasa" style={{fontSize:13}}>Bukti penyerahan dan pemberian obat biasa</h3>
  {regularDrugs.map(rx=><ObatBiasaEvidence key={rx.id} rx={rx} evidence={evidence} recordId={recordId} active={active}/>)}
  {!regularDrugs.length&&<p>Belum ada obat biasa dalam resep tersimpan untuk kunjungan ini.</p>}
  <p style={{fontSize:12}}>Status resep, penyerahan farmasi dan pembayaran bukan bukti obat sudah diberikan kepada pasien. Pemberian obat biasa hanya terbukti dari catatan pemberian per resep di atas; catatan pemberian obat berprotokol berada pada <a href="#obat-khusus">Obat Khusus</a>.</p>
  <details><summary>Batas data handoff yang belum tersambung</summary><ul>{sourceStatus.gaps.map(gap=><li key={gap}>{gap}</li>)}</ul></details>
  <details><summary>Faktur kunjungan dan batas informasi pembayaran</summary><div style={{display:'flex',gap:5,flexWrap:'wrap',marginTop:8}}>{data.invoices.map(invoice=><InvoiceTag key={invoice.id} invoice={invoice}/>)}</div>{!data.invoices.length&&<p>Belum ada faktur tersimpan untuk kunjungan ini.</p>}<p><Link className="back-btn" href={`/klinik/pembayaran/${encodeURIComponent(visitId)}`}>Buka pembayaran kunjungan</Link></p><p>Faktur tanpa tautan per baris tidak dipasangkan ke obat/tindakan. Status dan qty faktur ditampilkan sesuai dokumen asal.</p><p>Lama inap terbayar belum dapat dipastikan. Periksa rincian tagihan; tanggal masuk bukan bukti pembayaran durasi rawat inap.</p></details>
 </section>;
}
