"use client";
import Link from 'next/link';
import {usePathname,useSearchParams} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
import {useDraftUserId} from './LocalTransactionDraft';
import {readReportPresets,reportPresetHref,reportPresetKey,type ReportPreset} from '@/lib/report-presets';
import {listPrivateReportPresets,savePrivateReportPreset,deletePrivateReportPreset,type PrivatePresetResult} from '@/app/(app)/laporan/preset-actions';

export function ReportPresets({title,directory=false,appliedDefaults=''}:{title:string;directory?:boolean;appliedDefaults?:string}){
 const userId=useDraftUserId(),path=usePathname(),query=useSearchParams().toString();
 if(!userId||(!directory&&!path.startsWith('/laporan/')))return null;
 return <PresetEditor key={`${userId}:${path}:${query}:${appliedDefaults}`} userId={userId} path={path} query={query} title={title} directory={directory} appliedDefaults={appliedDefaults}/>;
}
function PresetEditor({userId,path,query,title,directory,appliedDefaults}:{userId:string;path:string;query:string;title:string;directory:boolean;appliedDefaults:string}){
 const [rows,setRows]=useState<ReportPreset[]>([]),[legacy,setLegacy]=useState<ReportPreset[]>([]),[name,setName]=useState(''),[error,setError]=useState(''),[warning,setWarning]=useState('');
 const [ready,setReady]=useState(false),[loading,setLoading]=useState(true),[pending,setPending]=useState(false);
 const retry=useRef<{signature:string;id:string}|null>(null);
 useEffect(()=>{
  let active=true;
  void listPrivateReportPresets(userId).then(result=>{
   if(!active)return;
   if(result.ok&&result.userId===userId){setRows(result.rows);setReady(true);setError('');}
   else setError(result.ok?'Akun berubah. Muat ulang halaman.':result.message);
  }).catch(()=>{if(active)setError('Konfigurasi akun belum dapat dimuat. Muat ulang daftar.');}).finally(()=>{if(active)setLoading(false);});
  try{const saved=readReportPresets(localStorage.getItem(reportPresetKey(userId)));queueMicrotask(()=>{if(active)setLegacy(saved);});}
  catch{queueMicrotask(()=>{if(active)setWarning('Konfigurasi browser lama tidak dapat dibaca. Konfigurasi akun tetap dapat digunakan.');});}
  return ()=>{active=false;};
 },[userId]);
 function accept(result:PrivatePresetResult){
  if(!result.ok){setError(result.message);return false;}
  if(result.userId!==userId){setError('Akun berubah. Muat ulang halaman.');return false;}
  setRows(result.rows);setReady(true);setError('');return true;
 }
 async function reload(){setLoading(true);try{accept(await listPrivateReportPresets(userId));}catch{setError('Konfigurasi akun belum dapat dimuat. Muat ulang daftar.');}finally{setLoading(false);}}
 async function save(label:string,href:string,id?:string){
  const signature=JSON.stringify([label,href,id]);
  if(retry.current?.signature!==signature)retry.current={signature,id:id??crypto.randomUUID()};
  setPending(true);
  try{if(accept(await savePrivateReportPreset({id:retry.current.id,name:label,href,expectedUserId:userId}))){retry.current=null;return true;}}
  catch{setError('Hasil penyimpanan belum dapat dikonfirmasi. Muat ulang daftar sebelum mencoba lagi.');}
  finally{setPending(false);}
  return false;
 }
 async function saveCurrent(){
  try{
   const defaults=new URLSearchParams(appliedDefaults),explicit=new URLSearchParams(query);
   for(const key of new Set(explicit.keys()))if(!defaults.has(key))for(const value of explicit.getAll(key))defaults.append(key,value);
   if(await save(name.trim(),reportPresetHref(path,defaults.toString())))setName('');
  }catch{setError('Filter atau pilihan kolom tidak valid. Muat ulang laporan sebelum menyimpan.');}
 }
 async function remove(id:string){setPending(true);try{accept(await deletePrivateReportPreset(id,userId));}catch{setError('Hasil penghapusan belum dapat dikonfirmasi. Muat ulang daftar sebelum mencoba lagi.');}finally{setPending(false);}}
 const old=legacy.filter(row=>!rows.some(saved=>saved.id===row.id||(saved.name===row.name&&saved.href===row.href)));
 return <div className="crm-sec no-print" style={{marginBottom:12,overflowWrap:'anywhere'}} aria-busy={loading||pending}>
  <strong>Konfigurasi laporan tersimpan</strong>
  <p style={{fontSize:12,margin:'6px 0'}}>Pribadi untuk akun ini dan tersedia di browser lain setelah masuk dengan akun yang sama. Filter serta pilihan kolom yang telah diterapkan disimpan; data dan izin akses mengikuti laporan asal.</p>
  <button type="button" className="btn-def" disabled={loading||pending} onClick={()=>void reload()}>Muat ulang daftar</button>
  {!directory&&<div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center',marginTop:8}}>
   <input className="fi" aria-label="Nama konfigurasi laporan" maxLength={80} disabled={pending||loading} placeholder={`Nama konfigurasi ${title}`} value={name} onChange={e=>setName(e.target.value)} style={{width:260,maxWidth:'100%'}}/>
   <button type="button" className="btn-def" disabled={!ready||loading||pending||!name.trim()} onClick={()=>void saveCurrent()}>{pending?'Menyimpan…':'Simpan konfigurasi'}</button>
  </div>}
  {error&&<p role="alert">{error}</p>}{warning&&<p role="status">{warning}</p>}
  {loading?<p>Memuat konfigurasi akun…</p>:ready&&rows.length===0?<p style={{fontSize:12,marginBottom:0}}>Belum ada konfigurasi tersimpan.</p>:null}
  {rows.length>0&&<ul style={{paddingLeft:20,marginBottom:0}}>{rows.map(row=><li key={row.id} style={{marginTop:8}}>
   <Link href={row.href}>{row.name}</Link>{' '}<small>({row.href.split('?')[0].slice(9)})</small>{' '}
   <button type="button" className="btn-def" disabled={pending||loading} onClick={()=>void remove(row.id)}>{`Hapus ${row.name}`}</button>
  </li>)}</ul>}
  {old.length>0&&<details style={{marginTop:10}}><summary>Konfigurasi browser lama — belum disalin ke akun</summary><ul>{old.map(row=><li key={row.id}>
   <Link href={row.href}>{row.name}</Link>{' '}<button type="button" className="btn-def" disabled={!ready||loading||pending} onClick={()=>void save(row.name,row.href,/^[0-9a-f-]{36}$/i.test(row.id)?row.id:undefined)}>{`Salin ${row.name} ke akun`}</button>
  </li>)}</ul></details>}
 </div>;
}
