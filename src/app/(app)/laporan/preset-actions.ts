"use server";

import {createClient} from '@/lib/supabase/server';
import {bolehBukaPath,SEMUA_PERAN} from '@/lib/akses';
import {readCompleteList} from '@/lib/checked-list';
import {readReportPresets,type ReportPreset} from '@/lib/report-presets';

type Success={ok:true;userId:string;rows:ReportPreset[]};
type Failure={ok:false;message:string};
export type PrivatePresetResult=Success|Failure;
const invalid='Konfigurasi laporan tidak valid. Periksa nama dan tujuan laporan.';
const unavailable='Konfigurasi akun belum dapat diverifikasi. Muat ulang daftar.';
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
async function context(expectedUserId?:unknown){
 const db=await createClient();const {data:{user},error}=await db.auth.getUser();
 if(error||!user)throw Error('Akun belum tersedia. Silakan masuk kembali.');
 if(expectedUserId!==undefined&&expectedUserId!==user.id)throw Error('Akun berubah. Muat ulang halaman.');
 const {data:profile,error:profileError}=await db.from('profiles').select('role,is_active').eq('id',user.id).maybeSingle();
 if(profileError||!profile?.is_active||!SEMUA_PERAN.some(role=>role===profile.role))throw Error(unavailable);
 const {data:modules,error:moduleError}=await db.from('role_modules').select('role,module_id');
 if(moduleError||!modules||!bolehBukaPath(profile.role,'/laporan',modules))throw Error('Akses laporan tidak tersedia untuk akun ini.');
 return {db,userId:user.id};
}
type Context=Awaited<ReturnType<typeof context>>;
async function rowsFor({db,userId}:Context):Promise<Success>{
 const records=await readCompleteList<{id:string;name:string;href:string;saved_at:string}>((from,to)=>db.from('private_report_presets')
  .select('id,name,href,saved_at',{count:'exact'}).eq('user_id',userId).order('saved_at',{ascending:false}).order('id').range(from,to),'Konfigurasi laporan',{maxRows:50});
 return {ok:true,userId,rows:readReportPresets(JSON.stringify(records.map(row=>({id:row.id,name:row.name,href:row.href,savedAt:row.saved_at}))))};
}
function failure(message=unavailable):Failure{return {ok:false,message};}
export async function listPrivateReportPresets(expectedUserId?:string):Promise<PrivatePresetResult>{
 try{return await rowsFor(await context(expectedUserId));}catch{return failure();}
}
export async function savePrivateReportPreset(input:unknown):Promise<PrivatePresetResult>{
 let entry:ReportPreset;
 try{
  if(!input||typeof input!=='object')return failure(invalid);
  const value=input as Record<string,unknown>;
  if(!uuid(value.id))return failure(invalid);
  [entry]=readReportPresets(JSON.stringify([{id:value.id,name:value.name,href:value.href,savedAt:new Date().toISOString()}]));
 }catch{return failure(invalid);}
 try{
  const ctx=await context((input as Record<string,unknown>).expectedUserId);
  const {error}=await ctx.db.from('private_report_presets').upsert({id:entry.id,user_id:ctx.userId,name:entry.name,href:entry.href},{onConflict:'id'});
  if(error)return failure(error.message.includes('PRIVATE_PRESET_LIMIT:')?'Maksimal 50 konfigurasi per akun. Hapus konfigurasi yang tidak diperlukan.':'Hasil penyimpanan belum dapat dikonfirmasi. Muat ulang daftar sebelum mencoba lagi.');
  return await rowsFor(ctx);
 }catch{return failure('Hasil penyimpanan belum dapat dikonfirmasi. Muat ulang daftar sebelum mencoba lagi.');}
}
export async function deletePrivateReportPreset(id:unknown,expectedUserId?:string):Promise<PrivatePresetResult>{
 if(!uuid(id))return failure(invalid);
 try{
  const ctx=await context(expectedUserId);const {error}=await ctx.db.from('private_report_presets').delete().eq('id',id).eq('user_id',ctx.userId);
  if(error)return failure('Hasil penghapusan belum dapat dikonfirmasi. Muat ulang daftar sebelum mencoba lagi.');
  return await rowsFor(ctx);
 }catch{return failure('Hasil penghapusan belum dapat dikonfirmasi. Muat ulang daftar sebelum mencoba lagi.');}
}
