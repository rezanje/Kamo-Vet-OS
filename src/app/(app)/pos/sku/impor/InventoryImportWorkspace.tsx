"use client";
import Link from "next/link";
import {useState} from "react";
import {AccurateImportForm} from "./AccurateImportForm";
import {StockOnlyImport,StockValuation} from "./StockOnlyImport";
import type {InitialStockState} from "./actions";
import type {ProgresImpor} from "@/lib/impor-accurate-batch";
import {initialStockBatchStage} from "@/lib/initial-stock-batch-status";
export type RecoverableStockBatch={id:string;source_name:string;status:string;as_of_date:string|null};
export type RecoverableMasterBatch={id:string;source_name:string;status:string;progress:ProgresImpor|null;rejectedCount?:number|null};
export type RejectedMasterRows={runId:string;sourceName:string;page:number;rows:{source_row:number;source_code:string|null;source:string|null;reason:string|null}[];hasNext:boolean;error:string|null};
export function InventoryImportWorkspace({batches,masterBatches,masterError,masterReview,recovered,recoveredRunId=null,initialReceipt}:{batches:RecoverableStockBatch[];masterBatches:RecoverableMasterBatch[];masterError:string|null;masterReview?:RejectedMasterRows|null;recovered:InitialStockState|null;recoveredRunId?:string|null;initialReceipt:{stockCount:number;problemCount:number}|null}){
 const [mode,setMode]=useState('');
 return <>
  <section className="crm-sec" aria-label="Status batch master Accurate tersimpan">
   <h2 style={{fontSize:15}}>Status batch master Accurate</h2>
   <p>Catatan terakhir milik akun ini. Membuka halaman ini tidak melanjutkan impor; file yang belum selesai tetap harus dipilih ulang.</p>
   {masterError?<p role="alert">Daftar batch master belum dapat dimuat: {masterError}</p>:masterBatches.length ? masterBatches.map(b=><div key={b.id}>
    <strong>{b.source_name}</strong> · {b.status==='posted'?(b.rejectedCount===null||b.rejectedCount===undefined?'Proses tersimpan; hasil baris belum dapat dipastikan':b.rejectedCount>0?`Master selesai sebagian; ${b.rejectedCount} baris ditolak untuk diperbaiki; saldo awal ditinjau terpisah`:'Master tercatat selesai; saldo awal ditinjau terpisah'):b.status==='failed'?'Proses gagal':'Pemeriksaan atau impor belum terkonfirmasi selesai'} · {b.id.slice(0,8)}
    {b.progress&&<span> · Catatan terakhir: {b.progress.completed}/{b.progress.total} ({b.progress.percentage}%), fase {b.progress.phase}</span>}
    {b.rejectedCount!==null&&b.rejectedCount!==undefined&&b.rejectedCount>0&&<> · <Link href={`/pos/sku/impor?master_run_id=${encodeURIComponent(b.id)}`}>Lihat baris ditolak</Link></>}
   </div>):<p>Belum ada batch master tersimpan untuk akun ini.</p>}
   {masterReview&&<div aria-label="Baris master ditolak" style={{marginTop:12}}>
    <h3 style={{fontSize:14}}>Baris ditolak: {masterReview.sourceName}</h3>
    {masterReview.error?<p role="alert">{masterReview.error}</p>:<>
     {masterReview.rows.length?<div style={{overflowX:"auto"}}><table><thead><tr><th>File sumber</th><th>Baris sumber</th><th>Kode SKU</th><th>Alasan</th></tr></thead><tbody>{masterReview.rows.map((row,index)=><tr key={`${row.source_row}-${index}`}><td>{row.source||"Tidak tercatat pada batch lama"}</td><td>{row.source_row}</td><td>{row.source_code||"—"}</td><td>{row.reason||"Alasan tidak tersimpan; periksa ulang file sumber."}</td></tr>)}</tbody></table></div>:<p>Tidak ada baris ditolak pada halaman ini.</p>}
     {masterReview.page>1&&<Link href={`/pos/sku/impor?master_run_id=${encodeURIComponent(masterReview.runId)}&master_page=${masterReview.page-1}`}>Halaman sebelumnya</Link>}
     {masterReview.hasNext&&<> · <Link href={`/pos/sku/impor?master_run_id=${encodeURIComponent(masterReview.runId)}&master_page=${masterReview.page+1}`}>Halaman berikutnya</Link></>}
    </>}
   </div>}
   <p>Periksa hasil batch sebelum mencoba impor ulang bila status belum pasti.</p>
  </section>
  <section className="crm-sec" aria-label="Batch saldo tersimpan">
   <h2 style={{fontSize:15}}>Lanjutkan batch saldo tersimpan</h2>
   <p>Daftar milik akun ini, sesuai akses cabang. Pemulihan membaca batch yang sama dan tidak menyiapkan atau memposting ulang. File di browser tidak ikut tersimpan: hanya batch yang sudah disiapkan yang dapat dibuka lagi setelah pindah halaman atau muat ulang.</p>
   {batches.map(b=><div key={b.id}><Link href={`/pos/sku/impor?run_id=${encodeURIComponent(b.id)}`}>{b.source_name} · {b.as_of_date ?? "tanpa tanggal"} · {initialStockBatchStage(b.status)} · {b.id.slice(0,8)}</Link></div>)}
   {!batches.length&&<p>Belum ada batch tersimpan untuk akun ini.</p>}
   {recovered&&!recovered.ok&&<p role="alert">{recoveredRunId?`Batch ${recoveredRunId.slice(0,8)} belum dapat dibuka: `:""}{recovered.message} Jangan siapkan ulang file sebelum status batch ini terbaca; muat ulang untuk mencoba lagi.</p>}
   {recovered?.ok&&recovered.run_id&&<div role="status"><p>{recovered.message}</p><StockValuation state={recovered}/><Link className="btn-acc" href={`/keuangan/persediaan-awal?run_id=${recovered.run_id}`}>Lanjutkan review / bukti posting batch</Link></div>}
  </section>
  <label>Mode impor <select aria-label="Mode impor" value={mode} onChange={e=>setMode(e.target.value)}><option value="">Pilih tujuan impor</option><option value="master">Perbarui master dan kategori; siapkan saldo</option><option value="stock_only">Siapkan saldo saja — kategori master tetap</option></select></label>
  {!mode&&<p>Pilih mode sesuai tujuan file. Mode saldo saja memakai SKU yang sudah ada dan tidak memperbarui kategori barang.</p>}
  {mode==='master'?<AccurateImportForm initialReceipt={initialReceipt}/>:mode==='stock_only'?<StockOnlyImport/>:null}
 </>;
}
