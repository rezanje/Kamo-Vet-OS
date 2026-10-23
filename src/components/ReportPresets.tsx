"use client";
import Link from 'next/link';
import {usePathname,useSearchParams} from 'next/navigation';
import {useEffect,useState} from 'react';
import {useDraftUserId} from './LocalTransactionDraft';
import {readReportPresets,reportPresetHref,reportPresetKey,saveReportPreset,type ReportPreset} from '@/lib/report-presets';

export function ReportPresets({title,directory=false,appliedDefaults=''}:{title:string;directory?:boolean;appliedDefaults?:string}){
 const userId=useDraftUserId(),path=usePathname(),query=useSearchParams().toString();
 return <PresetEditor key={`${userId}:${path}:${query}:${appliedDefaults}`} userId={userId} path={path} query={query} title={title} directory={directory} appliedDefaults={appliedDefaults}/>;
}
function PresetEditor({userId,path,query,title,directory,appliedDefaults}:{userId:string;path:string;query:string;title:string;directory:boolean;appliedDefaults:string}){
 const [rows,setRows]=useState<ReportPreset[]>([]),[name,setName]=useState(''),[error,setError]=useState(''),[ready,setReady]=useState(false);
 useEffect(()=>{
  if(!userId)return;
  let active=true;
  try {
   const saved=readReportPresets(localStorage.getItem(reportPresetKey(userId)));
   queueMicrotask(()=>{if(active){setRows(saved);setReady(true);}});
  }catch{queueMicrotask(()=>{if(active)setError('Konfigurasi browser tidak dapat dibaca. Data tersimpan tidak diubah.');});}
  const refresh=(event:StorageEvent)=>{if(event.key!==reportPresetKey(userId))return;try{setRows(readReportPresets(event.newValue));setError('');}catch{setError('Konfigurasi browser tidak dapat dibaca.');}};
  window.addEventListener('storage',refresh);return ()=>{active=false;window.removeEventListener('storage',refresh);};
 },[userId]);
 function persist(change:(saved:ReportPreset[])=>ReportPreset[]){
  try{const key=reportPresetKey(userId),saved=change(readReportPresets(localStorage.getItem(key)));localStorage.setItem(key,JSON.stringify(saved));setRows(saved);setError('');return true;}
  catch{setError('Perubahan konfigurasi belum tersimpan. Periksa penyimpanan browser; konfigurasi sebelumnya tetap tersedia.');return false;}
 }
 if(!userId)return null;
 // Shared report wrappers are also used outside /laporan; those routes are excluded.
 if(!directory&&!path.startsWith('/laporan/'))return null;
 return <div className="crm-sec no-print" style={{marginBottom:12,overflowWrap:'anywhere'}}>
  <strong>Konfigurasi laporan tersimpan</strong>
  <p style={{fontSize:12,margin:'6px 0'}}>Pribadi untuk akun ini di browser ini. Filter yang telah ditampilkan disimpan; data laporan dan izin akses tetap mengikuti laporan asal.</p>
  {!directory&&<div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center'}}>
   <input className="fi" aria-label="Nama konfigurasi laporan" maxLength={80} placeholder={`Nama konfigurasi ${title}`} value={name} onChange={e=>setName(e.target.value)} style={{width:260,maxWidth:'100%'}}/>
   <button type="button" className="btn-def" disabled={!ready||!name.trim()} onClick={()=>{if(persist(saved=>{
    const defaults=new URLSearchParams(appliedDefaults),explicit=new URLSearchParams(query);
    for(const key of new Set(explicit.keys()))if(!defaults.has(key))for(const value of explicit.getAll(key))defaults.append(key,value);
    return saveReportPreset(saved,{id:crypto.randomUUID(),name:name.trim(),href:reportPresetHref(path,defaults.toString()),savedAt:new Date().toISOString()});
   }))setName('');}}>Simpan konfigurasi</button>
  </div>}
  {error&&<p role="alert">{error}</p>}
  {rows.length===0?<p style={{fontSize:12,marginBottom:0}}>Belum ada konfigurasi tersimpan.</p>:<ul style={{paddingLeft:20,marginBottom:0}}>{rows.map(row=><li key={row.id} style={{marginTop:8}}>
   <Link href={row.href}>{row.name}</Link>{' '}<small>({row.href.split('?')[0].slice(9)})</small>{' '}
   <button type="button" className="btn-def" onClick={()=>persist(saved=>saved.filter(x=>x.id!==row.id))}>{`Hapus ${row.name}`}</button>
  </li>)}</ul>}
 </div>;
}
