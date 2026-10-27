import { beforeEach, expect, it, vi } from 'vitest';
const f=vi.hoisted(()=>({migrated:true,stay:'sakit',calls:[] as {name:string,args:Record<string,unknown>}[]}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('next/navigation',()=>({redirect:(href:string)=>{throw new Error(`REDIRECT ${href}`)}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({
 auth:{getUser:async()=>({data:{user:{id:'user'}}})},
 rpc:async(name:string,args:Record<string,unknown>)=>{f.calls.push({name,args});
  if(!f.migrated&&(name==='clinic_admit_inpatient_typed'||name==='clinic_continue_visit_to_inpatient'))return {data:null,error:{code:'PGRST202',message:'Could not find the function'}};
  if(name==='clinic_continue_visit_to_inpatient')return {data:'continuation-visit',error:null};
  if(name.startsWith('clinic_admit_inpatient'))return {data:'stay',error:null};
  return {data:'log',error:null}},
 from(table:string){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},in(){return q},
  maybeSingle:async()=>({data:table==='inpatient_records'?{condition_status:'stabil',visit_id:'visit',medical_record_id:'record'}:{role:'OWNER'},error:null}),
  then(resolve:(v:unknown)=>void){return Promise.resolve(f.migrated?{data:table==='inpatient_records'?[{id:'stay',stay_type:f.stay}]:[],error:null}:{data:null,error:{message:'column inpatient_records.stay_type does not exist'}}).then(resolve)}};return q},
})}));
import { admitInpatient, continueToInpatient, addDailyLogPos } from '../../app/(app)/klinik/rawat-inap/actions';
import { parseStayType, stayTypeOf } from '../inpatient-stay';
import { clinicAdmissionReadiness } from '../clinic-admission-readiness';
beforeEach(()=>{f.migrated=true;f.stay='sakit';f.calls=[];});
const form=(v:Record<string,string>)=>{const d=new FormData();for(const [k,x] of Object.entries(v))d.set(k,x);return d;};
const run=async(p:Promise<unknown>)=>{try{await p;return 'returned';}catch(e){return (e as Error).message;}};

it('K14 admission sends the chosen stay type through the typed RPC',async()=>{
 expect(await run(admitInpatient(form({visitId:'v',treatment_plan:'Titip 3 hari',request_key:'k',stay_type:'pet_hotel'})))).toContain('REDIRECT /klinik/rawat-inap/stay?success=admit');
 expect(f.calls).toEqual([{name:'clinic_admit_inpatient_typed',args:expect.objectContaining({p_stay_type:'pet_hotel',p_request_key:'k'})}]);
});
it('K14 before migration: sick admission falls back to the old RPC, pet hotel is refused clearly',async()=>{
 f.migrated=false;
 expect(await run(admitInpatient(form({visitId:'v',treatment_plan:'Infus',request_key:'k',stay_type:'sakit'})))).toContain('/klinik/rawat-inap/stay');
 expect(f.calls.map(c=>c.name)).toEqual(['clinic_admit_inpatient_typed','clinic_admit_inpatient']);
 f.calls=[];
 expect(await run(admitInpatient(form({visitId:'v',treatment_plan:'Titip',request_key:'k',stay_type:'pet_hotel'})))).toContain('Tipe%20pet%20hotel%20belum%20aktif');
 expect(f.calls.map(c=>c.name)).toEqual(['clinic_admit_inpatient_typed']);
});
it('K14 rejects an unknown stay type without calling the database',async()=>{
 expect(await run(admitInpatient(form({visitId:'v',treatment_plan:'x',request_key:'k',stay_type:'spa'})))).toContain('Pilih%20tipe%20rawat%20inap');
 expect(f.calls).toEqual([]);
});
it('K06 continuation opens the linked visit and lands on its medical record',async()=>{
 expect(await run(continueToInpatient(form({visitId:'paid-visit',request_key:'k6'})))).toContain('REDIRECT /klinik/rekam-medis/continuation-visit?success=lanjutan');
 expect(f.calls).toEqual([{name:'clinic_continue_visit_to_inpatient',args:{p_visit_id:'paid-visit',p_request_key:'k6'}}]);
 f.migrated=false;
 expect(await run(continueToInpatient(form({visitId:'paid-visit',request_key:'k6'})))).toContain('belum%20aktif%20di%20database');
});
it('K14 pet hotel daily log requires a paramedic; sick stays keep the previous rule',async()=>{
 const log={recordId:'stay',condition_note:'Sehat',request_key:'l',log_kind:'monitoring',makan:'habis'};
 f.stay='pet_hotel';
 expect(await run(addDailyLogPos(form(log)))).toContain('Pilih%20paramedis');
 expect(f.calls).toEqual([]);
 expect(await run(addDailyLogPos(form({...log,paramedic_id:'0d000000-0000-4000-8000-000000000001'})))).toBe('returned');
 f.stay='sakit';f.calls=[];
 expect(await run(addDailyLogPos(form(log)))).toBe('returned');
 expect(f.calls.map(c=>c.name)).toEqual(['clinic_save_inpatient_log_with_status']);
});
it('stay type parsing defaults existing rows to sakit',()=>{
 expect(stayTypeOf(undefined)).toBe('sakit');expect(stayTypeOf('pet_hotel')).toBe('pet_hotel');
 expect(parseStayType(null)).toBe('sakit');expect(parseStayType('x')).toBeNull();
});
it('K06 readiness: closed visit with exam and doctor continues; missing exam still blocks first',()=>{
 const base={readFailed:false,checkedOutAt:null,doctorId:'d',medicalRecordId:'m',rule:{wajib:true,template_id:null},consents:[]};
 expect(clinicAdmissionReadiness({...base,status:'Selesai'})).toMatchObject({canAdmit:false,continueFromClosed:true});
 expect(clinicAdmissionReadiness({...base,status:'Pembayaran',hasActiveInvoice:true})).toMatchObject({continueFromClosed:true});
 expect(clinicAdmissionReadiness({...base,status:'Selesai',medicalRecordId:null})).toMatchObject({continueFromClosed:false,canAdmit:false});
 expect(clinicAdmissionReadiness({...base,status:'Pembayaran'})).toMatchObject({continueFromClosed:false,consentAction:true});
});
