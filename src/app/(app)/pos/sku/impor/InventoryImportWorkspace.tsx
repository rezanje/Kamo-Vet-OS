"use client";
import Link from "next/link";
import {useState} from "react";
import {AccurateImportForm} from "./AccurateImportForm";
import {StockOnlyImport,StockValuation} from "./StockOnlyImport";
import type {InitialStockState} from "./actions";
import type {ProgresImpor} from "@/lib/impor-accurate-batch";
export type RecoverableStockBatch={id:string;source_name:string;status:string;as_of_date:string|null};
export type RecoverableMasterBatch={id:string;source_name:string;status:string;progress:ProgresImpor|null;rejectedCount?:number|null};
export function InventoryImportWorkspace({batches,masterBatches,masterError,recovered,initialReceipt}:{batches:RecoverableStockBatch[];masterBatches:RecoverableMasterBatch[];masterError:string|null;recovered:InitialStockState|null;initialReceipt:{stockCount:number;problemCount:number}|null}){
 const [mode,setMode]=useState('');
 return <>
  <section className="crm-sec" aria-label="Status batch master Accurate tersimpan">
   <h2 style={{fontSize:15}}>Status batch master Accurate</h2>
   <p>Catatan terakhir milik akun ini. Membuka halaman ini tidak melanjutkan impor; file yang belum selesai tetap harus dipilih ulang.</p>
   {masterError?<p role="alert">Daftar batch master belum dapat dimuat: {masterError}</p>:masterBatches.length ? masterBatches.map(b=><div key={b.id}>
    <strong>{b.source_name}</strong> · {b.status==='posted'?(b.rejectedCount===null||b.rejectedCount===undefined?'Proses tersimpan; hasil baris belum dapat dipastikan':b.rejectedCount>0?`Master selesai sebagian; ${b.rejectedCount} baris ditolak untuk diperbaiki; saldo awal ditinjau terpisah`:'Master tercatat selesai; saldo awal ditinjau terpisah'):b.status==='failed'?'Proses gagal':'Pemeriksaan atau impor belum terkonfirmasi selesai'} · {b.id.slice(0,8)}
    {b.progress&&<span> · Catatan terakhir: {b.progress.completed}/{b.progress.total} ({b.progress.percentage}%), fase {b.progress.phase}</span>}
   </div>):<p>Belum ada batch master tersimpan untuk akun ini.</p>}
   <p>Periksa hasil batch sebelum mencoba impor ulang bila status belum pasti.</p>
  </section>
  <section className="crm-sec" aria-label="Batch saldo tersimpan">
   <h2 style={{fontSize:15}}>Lanjutkan batch saldo tersimpan</h2>
   <p>Daftar milik akun ini, sesuai akses cabang. Pemulihan membaca batch yang sama dan tidak menyiapkan atau memposting ulang.</p>
   {batches.map(b=><div key={b.id}><Link href={`/pos/sku/impor?run_id=${b.id}`}>{b.source_name} · {b.as_of_date} · {b.status} · {b.id.slice(0,8)}</Link></div>)}
   {!batches.length&&<p>Belum ada batch tersimpan untuk akun ini.</p>}
   {recovered&&!recovered.ok&&<p role="alert">{recovered.message}</p>}
   {recovered?.ok&&recovered.run_id&&<div role="status"><p>{recovered.message}</p><StockValuation state={recovered}/><Link className="btn-acc" href={`/keuangan/persediaan-awal?run_id=${recovered.run_id}`}>Lanjutkan review / bukti posting batch</Link></div>}
  </section>
  <label>Mode impor <select aria-label="Mode impor" value={mode} onChange={e=>setMode(e.target.value)}><option value="">Pilih tujuan impor</option><option value="master">Perbarui master dan kategori; siapkan saldo</option><option value="stock_only">Siapkan saldo saja — kategori master tetap</option></select></label>
  {!mode&&<p>Pilih mode sesuai tujuan file. Mode saldo saja memakai SKU yang sudah ada dan tidak memperbarui kategori barang.</p>}
  {mode==='master'?<AccurateImportForm initialReceipt={initialReceipt}/>:mode==='stock_only'?<StockOnlyImport/>:null}
 </>;
}
