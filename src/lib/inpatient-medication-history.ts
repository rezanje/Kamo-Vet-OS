import type {createClient} from './supabase/server';
import {readCompleteList} from './checked-list';
type Db=Awaited<ReturnType<typeof createClient>>;
export type InpatientMedication={id:string;nama_obat:string;dosis:string|null;rute:string|null;frekuensi_per_hari:number;durasi_hari:number;mulai_tanggal:string;dihentikan_at:string|null;catatan:string|null};
export type InpatientDose={id:string;medication_id:string;diberikan_at:string;nama_pemberi:string|null;catatan:string|null;dibatalkan_at:string|null};
/** Same session/RLS; completeness is required before displaying empty history/progress. */
export async function loadInpatientMedicationHistory(db:Db,recordId:string):Promise<{medications:InpatientMedication[];doses:InpatientDose[]}|null>{
 try{
  const parent=await db.from('inpatient_records').select('id').eq('id',recordId).maybeSingle();
  if(parent.error||!parent.data)return null;
  const medications=await readCompleteList<InpatientMedication>((from,to)=>db.from('inpatient_medications')
   .select('id,nama_obat,dosis,rute,frekuensi_per_hari,durasi_hari,mulai_tanggal,dihentikan_at,catatan',{count:'exact'})
   .eq('inpatient_record_id',recordId).order('created_at',{ascending:false}).order('id').range(from,to),'Protokol obat rawat inap',{maxRows:null});
  const doses:InpatientDose[]=[];
  for(let offset=0;offset<medications.length;offset+=200){
   const ids=medications.slice(offset,offset+200).map(row=>row.id);
   doses.push(...await readCompleteList<InpatientDose>((from,to)=>db.from('inpatient_med_doses')
    .select('id,medication_id,diberikan_at,nama_pemberi,catatan,dibatalkan_at',{count:'exact'}).in('medication_id',ids)
    .order('diberikan_at',{ascending:false}).order('id').range(from,to),'Jejak pemberian obat rawat inap',{maxRows:null}));
  }
  return {medications,doses};
 }catch{return null;}
}
