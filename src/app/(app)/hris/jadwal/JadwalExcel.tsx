"use client";
import { useState } from 'react';
import { imporJadwal } from './actions';
import type { KaryawanBaris, ShiftOpsi } from './JadwalBoard';
import type { JadwalImpor } from '@/lib/jadwal-excel';
export function JadwalExcel({karyawan,shifts,awal,cabang,namaCabang,bulan,minggu,awalTanggal,akhirTanggal,employeeStarts,bolehKelola}: {
 karyawan:KaryawanBaris[];shifts:ShiftOpsi[];awal:Record<string,string>;cabang:string;namaCabang:string;bulan:string;minggu?:string;awalTanggal:string;akhirTanggal:string;employeeStarts:Record<string,string>;bolehKelola:boolean;
}) {
 const [preview,setPreview]=useState<{rows:JadwalImpor[];errors:string[];skipped:number}|null>(null);
 const [busy,setBusy]=useState(false); const [confirmed,setConfirmed]=useState(false);
 async function download(template:boolean) {
  setBusy(true);
  try {
   const {buatExcelJadwal}=await import('@/lib/jadwal-excel');
   const rows:JadwalImpor[]= template ? [] : Object.entries(awal).map(([key,shift_id])=>{const [employee_id,tanggal]=key.split('|');return {employee_id,tanggal,shift_id,branch_id:cabang};});
   const bytes=await buatExcelJadwal(rows,{employees:karyawan,shifts,branch:{id:cabang,name:namaCabang}});
   const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
   const link=document.createElement('a');link.href=url;link.download=`jadwal-${template?'template':awalTanggal}.xlsx`;link.click();URL.revokeObjectURL(url);
  } catch {setPreview({rows:[],errors:['Excel gagal dibuat. Coba ulangi.'],skipped:0});} finally {setBusy(false);}
 }
 async function read(file?:File) {
  setPreview(null);setConfirmed(false);if(!file)return;setBusy(true);
  try {
   if(!file.name.toLowerCase().endsWith('.xlsx') || file.size>900*1024) throw new Error('Gunakan .xlsx maksimal 900 KB.');
   const {bacaExcelJadwal,validasiJadwal}=await import('@/lib/jadwal-excel');
   const parsed=await bacaExcelJadwal(new Uint8Array(await file.arrayBuffer()));
   setPreview(parsed.errors.length ? {...parsed,skipped:0} : validasiJadwal(parsed.rows,{cabang,awal:awalTanggal,akhir:akhirTanggal,employees:karyawan.map(k=>k.id),shifts:shifts.filter(s=>s.is_active !== false).map(s=>s.id),employeeStarts,existing:awal}));
  } catch(e) {setPreview({rows:[],errors:[e instanceof Error?e.message:'File tidak terbaca.'],skipped:0});} finally {setBusy(false);}
 }
 return <section style={{marginTop:20}} aria-label="Excel jadwal">
  <h3>Excel Jadwal</h3>
  <p>Periode {awalTanggal} sampai {akhirTanggal}. Isi ID dari sheet Karyawan, Shift, dan Cabang pada template. Impor menambah sel kosong; jadwal yang sama dilewati. Ubah jadwal terisi lewat papan.</p>
  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btn-def" disabled={busy} onClick={()=>download(false)}>Ekspor periode</button>{bolehKelola && <button className="btn-def" disabled={busy} onClick={()=>download(true)}>Unduh template</button>}</div>
  {bolehKelola && <><label className="flab" htmlFor="excel-jadwal" style={{marginTop:12}}>Preview impor Excel</label><input id="excel-jadwal" type="file" accept=".xlsx" disabled={busy} onChange={e=>read(e.target.files?.[0])} /></>}
  {busy && <p role="status">Memproses Excel…</p>}
  {preview && <div aria-live="polite">
   <p>{preview.rows.length} baris baru · {preview.skipped} jadwal sama dilewati · {preview.errors.length} masalah.</p>
   {preview.errors.length>0 && <ul role="alert">{preview.errors.map((e,i)=><li key={i}>{e}</li>)}</ul>}
   {preview.rows.length>0 && <><div style={{overflowX:'auto',maxHeight:320}}><table className="tbl"><thead><tr><th>Karyawan</th><th>Tanggal</th><th>Shift</th><th>Jam</th></tr></thead><tbody>{preview.rows.map(r=>{const s=shifts.find(s=>s.id===r.shift_id);return <tr key={`${r.employee_id}|${r.tanggal}`}><td>{karyawan.find(k=>k.id===r.employee_id)?.nama}</td><td>{r.tanggal}</td><td>{s?.nama}</td><td>{s?.jam}</td></tr>;})}</tbody></table></div>
    <form action={imporJadwal}>
     <input type="hidden" name="cabang" value={cabang}/><input type="hidden" name="bulan" value={bulan}/><input type="hidden" name="minggu" value={minggu??''}/><input type="hidden" name="rows" value={JSON.stringify(preview.rows)}/>
     <label><input type="checkbox" name="konfirmasi" value="1" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Saya sudah memeriksa baris di atas</label>
     <button className="btn-acc" disabled={!confirmed||busy||preview.errors.length>0} style={{marginLeft:8}}>Simpan impor</button>
    </form></>}
  </div>}
 </section>;
}
