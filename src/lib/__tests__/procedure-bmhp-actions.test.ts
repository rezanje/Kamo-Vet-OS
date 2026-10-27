import { beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({supported:true as boolean,calls:[] as {name:string,args:Record<string,unknown>}[]}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('next/navigation',()=>({redirect:(href:string)=>{throw new Error(`REDIRECT ${href}`)}}));
vi.mock('@/lib/dokter',()=>({resolveDokter:async()=>({doctorId:'doctor',nama:'Drh. Fiction'})}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({
 auth:{getUser:async()=>({data:{user:{id:'user'}}})},
 rpc:async(name:string,args:Record<string,unknown>)=>{fixture.calls.push({name,args});
  if(name==='clinic_bmhp_supported')return fixture.supported?{data:true,error:null}:{data:null,error:{message:'function public.clinic_bmhp_supported() does not exist'}};
  return {data:null,error:null}},
 from(table:string){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},in(){return q},range(){return q},
 maybeSingle:async()=>({data:table==='inpatient_records'?{condition_status:'stabil',visit_id:'visit',medical_record_id:'record'}:table==='visits'?{branch_id:'branch',poli:'Poli Umum',status:'Diperiksa',pets:{species:'Kucing'}}:{role:'OWNER'},error:null}),
 then(resolve:(value:unknown)=>void){return Promise.resolve({data:table==='items'?[{id:'action-sku',unit:'tindakan',sell_price:75000}]:[],error:null}).then(resolve)}};return q},
})}));
import { simpanRekamMedis } from '../../app/(app)/klinik/rekam-medis/[visitId]/actions';
import { addDailyLogPos } from '../../app/(app)/klinik/rawat-inap/actions';
beforeEach(()=>{fixture.supported=true;fixture.calls=[];});
function form(resep:unknown[]){const data=new FormData();for(const [key,value] of Object.entries({visitId:'visit',petId:'pet',recordId:'inpatient',request_key:'stable-key',doctor_id:'doctor',keluhan:'Batuk',condition_note:'Fictional clinical note',next:'resep'}))data.set(key,value);data.set('resep',JSON.stringify(resep));return data;}
const cases=[['initial',simpanRekamMedis,'clinic_save_initial_record'],['inpatient',addDailyLogPos,'clinic_save_inpatient_log_with_status']] as const;

it.each(cases)('%s sends procedure BMHP IDs/qty/unit only, in the same atomic save',async(_n,save,rpc)=>{
 expect(await save(form([
  {item_id:'action-sku',nama_obat:'Vaksin',qty:1,harga:75000,jenis:'jasa',bmhp:[{item_id:'syr',nama:'Forged',qty:2,unit:'pcs',cost:1}]},
  {item_id:'action-sku',nama_obat:'Obat',qty:1,harga:100,jenis:'obat',bmhp:[{item_id:'syr',qty:1,unit:'pcs'}]},
 ]))).toMatchObject({saved:true});
 const call=fixture.calls.find(c=>c.name===rpc)!;
 expect(call.args.p_rows).toEqual([
  expect.objectContaining({jenis:'jasa',bmhp_components:[{item_id:'syr',qty:2,unit:'pcs'}]}),
  expect.not.objectContaining({bmhp_components:expect.anything()}),
 ]);
 expect(JSON.stringify(call.args)).not.toContain('Forged');
});

it.each(cases)('%s keeps the exact previous payload when no BMHP is chosen (no probe call)',async(_n,save,rpc)=>{
 expect(await save(form([{item_id:'action-sku',nama_obat:'Vaksin',qty:1,harga:75000,jenis:'jasa',bmhp:[]}]))).toMatchObject({saved:true});
 expect(fixture.calls.map(c=>c.name)).toEqual([rpc]);
 expect((fixture.calls[0].args.p_rows as Record<string,unknown>[])[0]).not.toHaveProperty('bmhp_components');
});

it.each(cases)('%s refuses BMHP before the database migration instead of silently dropping usage',async(_n,save,rpc)=>{
 fixture.supported=false;
 await expect(save(form([{item_id:'action-sku',nama_obat:'Vaksin',qty:1,harga:75000,jenis:'jasa',bmhp:[{item_id:'syr',qty:1,unit:'pcs'}]}]))).rejects.toThrow('REDIRECT');
 expect(fixture.calls.some(c=>c.name===rpc)).toBe(false);
});

it.each(cases)('%s rejects invalid BMHP before any write',async(_n,save,rpc)=>{
 await expect(save(form([{item_id:'action-sku',nama_obat:'Vaksin',qty:1,harga:75000,jenis:'jasa',bmhp:[{item_id:'syr',qty:0,unit:'pcs'}]}]))).rejects.toThrow('REDIRECT');
 expect(fixture.calls.some(c=>c.name===rpc)).toBe(false);
});
