import { beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({error:null as unknown,revalidated:[] as string[],doctorId:"doctor" as string|null,service:"Poli Umum"}));
vi.mock('next/cache',()=>({revalidatePath:(href:string)=>fixture.revalidated.push(href)}));
vi.mock('next/navigation',()=>({redirect:(href:string)=>{throw new Error(`REDIRECT ${href}`)}}));
vi.mock('@/lib/dokter',()=>({resolveDokter:async()=>({doctorId:fixture.doctorId,nama:fixture.doctorId?'Drh. Fiction':null})}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({
 auth:{getUser:async()=>({data:{user:{id:'user'}}})},
 rpc:async()=>({data:null,error:fixture.error}),
 from(table:string){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},in(){return q},
 maybeSingle:async()=>({data:table==='inpatient_records'?{condition_status:'stabil',visit_id:'visit',medical_record_id:'record'}:table==='visits'?{branch_id:'branch',poli:fixture.service,status:'Diperiksa',pets:{species:'Kucing'}}:{role:'OWNER'},error:null}),
 then(resolve:(value:unknown)=>void){return Promise.resolve({data:[],error:null}).then(resolve)}};return q},
})}));
import { simpanRekamMedis } from '../../app/(app)/klinik/rekam-medis/[visitId]/actions';
import { addDailyLogPos } from '../../app/(app)/klinik/rawat-inap/actions';
beforeEach(()=>{fixture.error=null;fixture.revalidated=[];fixture.doctorId='doctor';fixture.service='Poli Umum'});
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
