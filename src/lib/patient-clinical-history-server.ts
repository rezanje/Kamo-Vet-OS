import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';
import {createClient} from './supabase/server';
import {readCompleteList} from './checked-list';
import type {ClinicalAddendum,ClinicalRecord,ClinicalPrescription,PatientClinicalHistory,PatientClinicalVisit} from './patient-clinical-history';

type VisitRow=Omit<PatientClinicalVisit,'records'|'branchName'>&{branches:{name:string}|{name:string}[]|null};
type RecordRow=Omit<ClinicalRecord,'prescriptions'>&{visit_id:string};
type PrescriptionRow=ClinicalPrescription&{medical_record_id:string};

// Private to this clinical SELECT reader. Never export an unscoped client or use
// a service key: the same cookie session and unchanged RLS enforce branch grants.
async function patientReadClient(){
 const store=await cookies();
 return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
  global:{headers:{}},
  cookies:{getAll:()=>store.getAll(),setAll(values){try{values.forEach(({name,value,options})=>store.set(name,value,options));}catch{/* Server components cannot persist refreshed cookies. */}}},
 });
}

type RpcRecord={id:string;created_at:string;diagnosis:string|null;anamnesis:string|null;therapy:string|null;
 prescriptions?:ClinicalPrescription[]|null;addenda?:ClinicalAddendum[]|null};
type RpcVisit={id:string;pet_id:string;branch_id:string|null;branch_name:string|null;created_at:string;poli:string;
 dokter:string|null;keluhan:string|null;can_open:boolean|null;records?:RpcRecord[]|null};

/** K13: cross-branch history for ONE patient id through the checked, read-only
 * database reader. Returns null only when that reader is not installed yet, so
 * the branch-scoped reader below keeps working until the owner applies it.
 */
async function readViaHistoryRpc(visitId:string,expectedPetId:string):Promise<PatientClinicalHistory|null>{
 const unavailable:PatientClinicalHistory={available:false,visits:[]};
 const operational=await createClient();
 const {data,error}=await operational.rpc('clinic_patient_clinical_history',{p_pet_id:expectedPetId,p_anchor_visit_id:visitId});
 if(error)return error.code==='PGRST202'||error.code==='42883'?null:unavailable;
 const payload=data as {pet_id?:string;visits?:RpcVisit[]}|null;
 if(!payload||payload.pet_id!==expectedPetId||!Array.isArray(payload.visits))return unavailable;
 // Never mix another patient (same name or not) into this timeline.
 if(payload.visits.some(v=>v.pet_id!==expectedPetId)||!payload.visits.some(v=>v.id===visitId))return unavailable;
 return {available:true,visits:payload.visits.map(v=>({
  id:v.id,pet_id:v.pet_id,branch_id:v.branch_id,branchName:v.branch_name??'Cabang tidak tercatat',
  created_at:v.created_at,poli:v.poli,dokter:v.dokter,keluhan:v.keluhan,canOpen:v.can_open===true,
  records:(v.records??[]).map(m=>({id:m.id,created_at:m.created_at,diagnosis:m.diagnosis,anamnesis:m.anamnesis,therapy:m.therapy,
   prescriptions:m.prescriptions??[],addenda:m.addenda??[]})),
 }))};
}

/** The operational visit is authority; caller-supplied pet identity is only a
 * stale-display check. All cross-branch reads stay inside this exact patient.
 */
export async function readPatientClinicalHistory(visitId:string,expectedPetId:string):Promise<PatientClinicalHistory>{
 try{
  const viaRpc=await readViaHistoryRpc(visitId,expectedPetId);
  if(viaRpc)return viaRpc;
 }catch{return {available:false,visits:[]};}
 return readBranchScopedHistory(visitId,expectedPetId);
}

/** Pre-K13 reader: unchanged branch RLS (only branches granted to the account). */
async function readBranchScopedHistory(visitId:string,expectedPetId:string):Promise<PatientClinicalHistory>{
 const unavailable:PatientClinicalHistory={available:false,visits:[]};
 try{
  const operational=await createClient();
  const {data:{user},error:authError}=await operational.auth.getUser();
  if(authError||!user)return unavailable;
  const [{data:anchor,error:anchorError},{data:profile,error:profileError}]=await Promise.all([
   operational.from('visits').select('id,pet_id,branch_id').eq('id',visitId).maybeSingle(),
   operational.from('profiles').select('is_active').eq('id',user.id).maybeSingle(),
  ]);
  if(anchorError||profileError||!profile?.is_active||!anchor?.pet_id||anchor.pet_id!==expectedPetId)return unavailable;
  const history=await patientReadClient();
  const {data:{user:historyUser},error:historyAuthError}=await history.auth.getUser();
  if(historyAuthError||historyUser?.id!==user.id)return unavailable;
  const visits=await readCompleteList<VisitRow>((from,to)=>history.from('visits')
   .select('id,pet_id,branch_id,poli,dokter,keluhan,created_at,branches(name)',{count:'exact'})
   .eq('pet_id',anchor.pet_id).order('created_at',{ascending:false}).order('id').range(from,to),'Riwayat kunjungan pasien');
  const visitIds=new Set(visits.map(v=>v.id));
  if(!visitIds.has(visitId)||visits.some(v=>v.pet_id!==anchor.pet_id))return unavailable;
  const medical:RecordRow[]=[];
  const ids=[...visitIds];
  for(let start=0;start<ids.length;start+=200){
   const batch=ids.slice(start,start+200);
   const rows=await readCompleteList<RecordRow>((from,to)=>history.from('medical_records')
    .select('id,visit_id,diagnosis,anamnesis,therapy,created_at',{count:'exact'}).in('visit_id',batch)
    .order('created_at',{ascending:false}).order('id').range(from,to),'Rekam medis pasien');
   if(rows.some(row=>!batch.includes(row.visit_id)))return unavailable;
   medical.push(...rows);
  }
  const prescriptions:PrescriptionRow[]=[];
  const recordIds=medical.map(m=>m.id);
  for(let start=0;start<recordIds.length;start+=200){
   const batch=recordIds.slice(start,start+200);
   const rows=await readCompleteList<PrescriptionRow>((from,to)=>history.from('prescription_items')
    .select('id,medical_record_id,nama_obat,qty,satuan,jenis,aturan_pakai',{count:'exact'}).in('medical_record_id',batch)
    .order('id').range(from,to),'Resep pasien');
   if(rows.some(row=>!batch.includes(row.medical_record_id)))return unavailable;
   prescriptions.push(...rows);
  }
  return {available:true,visits:visits.map(v=>({
   id:v.id,pet_id:v.pet_id,branch_id:v.branch_id,branchName:(Array.isArray(v.branches)?v.branches[0]:v.branches)?.name??'Cabang tidak tercatat',
   created_at:v.created_at,poli:v.poli,dokter:v.dokter,keluhan:v.keluhan,
   records:medical.filter(m=>m.visit_id===v.id).map(m=>({id:m.id,created_at:m.created_at,diagnosis:m.diagnosis,anamnesis:m.anamnesis,therapy:m.therapy,
    prescriptions:prescriptions.filter(p=>p.medical_record_id===m.id).map(p=>({id:p.id,nama_obat:p.nama_obat,qty:p.qty,satuan:p.satuan,jenis:p.jenis,aturan_pakai:p.aturan_pakai})),
   })),
  }))};
 }catch{return unavailable;}
}
