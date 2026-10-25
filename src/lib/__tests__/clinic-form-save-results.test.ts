import { beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({error:null as unknown,revalidated:[] as string[],doctorId:"doctor" as string|null,doctorGate:null as Promise<void>|null,doctorStarted:false,visitReadStarted:false,service:"Poli Umum",calls:[] as {name:string,args:Record<string,unknown>}[]}));
vi.mock('next/cache',()=>({revalidatePath:(href:string)=>fixture.revalidated.push(href)}));
vi.mock('next/navigation',()=>({redirect:(href:string)=>{throw new Error(`REDIRECT ${href}`)}}));
vi.mock('@/lib/dokter',()=>({resolveDokter:async()=>{fixture.doctorStarted=true;if(fixture.doctorGate)await fixture.doctorGate;return {doctorId:fixture.doctorId,nama:fixture.doctorId?'Drh. Fiction':null}}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({
 auth:{getUser:async()=>({data:{user:{id:'user'}}})},
 rpc:async(name:string,args:Record<string,unknown>)=>{fixture.calls.push({name,args});return {data:null,error:fixture.error}},
 from(table:string){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},in(){return q},range(){return q},
 maybeSingle:async()=>{if(table==='visits')fixture.visitReadStarted=true;return {data:table==='inpatient_records'?{condition_status:'stabil',visit_id:'visit',medical_record_id:'record'}:table==='visits'?{branch_id:'branch',poli:fixture.service,status:'Diperiksa',pets:{species:'Kucing'}}:{role:'OWNER'},error:null}},
 then(resolve:(value:unknown)=>void){return Promise.resolve({data:table==='items'?[{id:'action-sku',unit:'tindakan',sell_price:75000}]:[],error:null}).then(resolve)}};return q},
})}));
import { simpanRekamMedis } from '../../app/(app)/klinik/rekam-medis/[visitId]/actions';
import { addDailyLogPos } from '../../app/(app)/klinik/rawat-inap/actions';
beforeEach(()=>{fixture.error=null;fixture.calls=[];fixture.revalidated=[];fixture.doctorId='doctor';fixture.doctorGate=null;fixture.doctorStarted=false;fixture.visitReadStarted=false;fixture.service='Poli Umum'});
it('starts the independent visit read before doctor lookup completes',async()=>{
 let releaseDoctor!:()=>void;
 fixture.doctorGate=new Promise<void>(resolve=>{releaseDoctor=resolve});
 const saving=simpanRekamMedis(form());
 await vi.waitFor(()=>expect(fixture.doctorStarted).toBe(true));
 const visitStartedBeforeDoctorFinished=fixture.visitReadStarted;
 releaseDoctor();
 expect(await saving).toMatchObject({saved:true});
 expect(visitStartedBeforeDoctorFinished).toBe(true);
});
it.each([['initial', simpanRekamMedis, 'clinic_save_initial_record'], ['inpatient', addDailyLogPos, 'clinic_save_inpatient_log_with_status']] as const)('%s preserves catalog action identity, amount and consent category at save', async (_name, save, rpc) => {
 const data=form();
 data.set('resep', JSON.stringify([{ item_id:'action-sku', nama_obat:'Steril', qty:2, satuan:'tindakan', harga:75000, jenis:'jasa', kategori:'Operasi' }]));
 expect(await save(data)).toMatchObject({saved:true});
 expect(fixture.calls.find(call=>call.name===rpc)?.args.p_rows).toEqual([
  expect.objectContaining({item_id:'action-sku',nama_obat:'Steril',qty:2,satuan:'tindakan',harga:75000,jenis:'jasa',kategori:'Operasi'})
 ]);
});
function form(){const data=new FormData();for(const [key,value] of Object.entries({visitId:'visit',petId:'pet',recordId:'inpatient',request_key:'stable-key',doctor_id:'doctor',keluhan:'Batuk',condition_note:'Fictional clinical note',next:'resep',resep:'[]'}))data.set(key,value);return data;}
it('rejects medical completion with no resolved doctor',async()=>{
 fixture.doctorId=null;await expect(simpanRekamMedis(form())).rejects.toThrow(/^REDIRECT .*\?error=/);expect(fixture.revalidated).toEqual([]);
});
it('rejects whitespace-only complaints',async()=>{
 const data=form();data.set('keluhan','   ');await expect(simpanRekamMedis(data)).rejects.toThrow(/^REDIRECT .*\?error=/);expect(fixture.revalidated).toEqual([]);
});
it('preserves nonmedical grooming without a doctor',async()=>{
 fixture.doctorId=null;fixture.service='Grooming';const data=form();data.delete('keluhan');
 expect(await simpanRekamMedis(data)).toMatchObject({saved:true});
});
it('returns confirmed initial save destination so the client can clear its draft',async()=>{
 expect(await simpanRekamMedis(form())).toEqual({saved:true,href:'/klinik/rekam-medis/visit/resep'});
 expect(fixture.revalidated).toContain('/klinik/rekam-medis/visit');
});
it('returns confirmed inpatient save destination so the client can clear its draft',async()=>{
 expect(await addDailyLogPos(form())).toEqual({saved:true,href:'/klinik/rawat-inap/inpatient?success=log'});
 expect(fixture.revalidated).toContain('/klinik/rawat-inap/inpatient');
});
it('returns failed inpatient save to the editable form',async()=>{
 fixture.error={message:'STOCK_SHORT: Fictional medicine'};
 await expect(addDailyLogPos(form())).rejects.toThrow(/^REDIRECT \/klinik\/rawat-inap\/inpatient\/catatan\?error=/);
});

for(const [name,save] of [['initial',simpanRekamMedis],['inpatient',addDailyLogPos]] as const){
 for(const official of [false,true])it(`forwards master SKU binding for ${name} ${official?'official':'custom'} compound atomically`,async()=>{
  const data=form();data.set('resep',JSON.stringify([{key:'compound-key',sale_item_id:'master-sku',nama_obat:'Master compound',qty:1,harga:1200,jenis:'racikan',satuan:'racikan',faktor:1,item_id:null,...(official?{official_version_id:'formula-version'}:{ingredients:[{item_id:'material',nama:'Material',qty:0.5,satuan:'gram',harga:999999}],dosage_form:'puyer'})}]));
  expect(await save(data)).toMatchObject({saved:true});
  const call=fixture.calls.find(c=>c.name===(name==='initial'?'clinic_save_initial_record':'clinic_save_inpatient_log_with_status'))!;
  expect(call.args.p_rows).toEqual([]);
  expect(call.args.p_compounds).toEqual([expect.objectContaining({sale_item_id:'master-sku',request_key:'compound-key',...(official?{official_version_id:'formula-version'}:{recipe:expect.objectContaining({recipe_name:'Master compound'})})})]);
 });
}

it('rejects a doctor-visit report without selecting a master doctor before posting',async()=>{
 const data=form();data.set('log_kind','doctor_visit');
 await expect(addDailyLogPos(data)).rejects.toThrow('REDIRECT');expect(fixture.calls).toEqual([]);
});
it('sends separate doctor/paramedic IDs with the entire inpatient transaction',async()=>{
 const data=form();data.set('log_kind','doctor_visit');data.set('visit_doctor_id','dc000000-0000-4000-8000-000000000002');data.set('paramedic_id','dc000000-0000-4000-8000-000000000003');
 expect(await addDailyLogPos(data)).toMatchObject({saved:true});
 expect(fixture.calls.find(c=>c.name==='clinic_save_inpatient_log_with_status')?.args.p_log).toMatchObject({log_kind:'doctor_visit',visit_doctor_id:'dc000000-0000-4000-8000-000000000002',paramedic_id:'dc000000-0000-4000-8000-000000000003'});
});

it('persists optional therapy text in the existing atomic initial-record payload',async()=>{const data=form();data.set('therapy','Terapi fiktif\nObservasi');expect(await simpanRekamMedis(data)).toMatchObject({saved:true});expect(fixture.calls.find(c=>c.name==='clinic_save_initial_record')?.args.p_record).toMatchObject({therapy:'Terapi fiktif\nObservasi'});});
it.each([undefined,'','   '])('keeps blank or absent therapy omitted so pre-deployment request hashes remain compatible (%s)',async(value)=>{const data=form();if(value!==undefined)data.set('therapy',value);expect(await simpanRekamMedis(data)).toMatchObject({saved:true});expect(fixture.calls.find(c=>c.name==='clinic_save_initial_record')?.args.p_record).not.toHaveProperty('therapy');});
