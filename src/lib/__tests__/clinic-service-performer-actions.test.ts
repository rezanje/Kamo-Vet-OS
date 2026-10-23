import { beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({lostResponse:false,error:null as unknown,revalidated:[] as string[],doctorId:"doctor" as string|null,service:"Poli Umum",calls:[] as {name:string,args:Record<string,unknown>}[]}));
vi.mock('next/cache',()=>({revalidatePath:(href:string)=>fixture.revalidated.push(href)}));
vi.mock('next/navigation',()=>({redirect:(href:string)=>{throw new Error(`REDIRECT ${href}`)}}));
vi.mock('@/lib/dokter',()=>({resolveDokter:async()=>({doctorId:fixture.doctorId,nama:fixture.doctorId?'Drh. Fiction':null})}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({
 auth:{getUser:async()=>({data:{user:{id:'user'}}})},
 rpc:async(name:string,args:Record<string,unknown>)=>{fixture.calls.push({name,args});if(fixture.lostResponse){fixture.lostResponse=false;throw Error("Response lost after commit");}return {data:null,error:fixture.error}},
 from(table:string){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},in(){return q},range(){return q},
 maybeSingle:async()=>({data:table==='inpatient_records'?{condition_status:'stabil',visit_id:'visit',medical_record_id:'record'}:table==='visits'?{branch_id:'branch',poli:fixture.service,status:'Diperiksa',pets:{species:'Kucing'}}:{role:'OWNER'},error:null}),
 then(resolve:(value:unknown)=>void){return Promise.resolve({data:table==='items'?[{id:'action-sku',unit:'tindakan',sell_price:75000}]:[],error:null}).then(resolve)}};return q},
})}));
import { simpanRekamMedis } from '../../app/(app)/klinik/rekam-medis/[visitId]/actions';
import { addDailyLogPos } from '../../app/(app)/klinik/rawat-inap/actions';
beforeEach(()=>{fixture.lostResponse=false;fixture.error=null;fixture.calls=[];fixture.revalidated=[];fixture.doctorId='doctor';fixture.service='Poli Umum'});
function form(){const data=new FormData();for(const [key,value] of Object.entries({visitId:'visit',petId:'pet',recordId:'inpatient',request_key:'stable-key',doctor_id:'doctor',keluhan:'Batuk',condition_note:'Fictional clinical note',next:'resep',resep:'[]'}))data.set(key,value);return data;}

it.each([['initial', simpanRekamMedis, 'clinic_save_initial_record'], ['inpatient', addDailyLogPos, 'clinic_save_inpatient_log_with_status']] as const)('%s carries independent service performers in the same atomic save',async(_name,save,rpc)=>{
 const data=form();data.set('resep',JSON.stringify([
  {item_id:'action-sku',nama_obat:'Jasa A',qty:1,harga:75000,jenis:'jasa',service_performers:{doctor_id:'doctor-a',staff_id:null}},
  {item_id:'action-sku',nama_obat:'Jasa A',qty:1,harga:75000,jenis:'jasa',service_performers:{doctor_id:null,staff_id:'staff-b'}},
  {item_id:'action-sku',nama_obat:'Obat',qty:1,harga:100,jenis:'obat',service_performers:{doctor_id:'doctor-a',staff_id:'staff-b'}},
  {item_id:'action-sku',nama_obat:'Kosong',qty:1,harga:100,jenis:'jasa',service_performers:{doctor_id:null,staff_id:null}},
 ]));
 expect(await save(data)).toMatchObject({saved:true});
 const call=fixture.calls.find(call=>call.name===rpc)!;
 expect(call.args.p_rows).toEqual([
  expect.objectContaining({service_performers:{doctor_id:'doctor-a',staff_id:null}}),
  expect.objectContaining({service_performers:{doctor_id:null,staff_id:'staff-b'}}),
  expect.not.objectContaining({service_performers:expect.anything()}),
  expect.objectContaining({service_performers:{doctor_id:null,staff_id:null}}),
 ]);
 expect(fixture.calls).toHaveLength(1);
});

it.each([['initial', simpanRekamMedis], ['inpatient', addDailyLogPos]] as const)('%s replays the exact pre-performer row shape after a lost response',async(_name,save)=>{
 const data=form();data.set('resep',JSON.stringify([
  {item_id:'action-sku',nama_obat:'Obat',qty:1,harga:100,jenis:'obat'},
  {item_id:'action-sku',nama_obat:'Jasa lama',qty:1,harga:100,jenis:'jasa',service_performers:null},
 ]));fixture.lostResponse=true;
 await expect(save(data)).rejects.toThrow('Response lost after commit');
 await expect(save(data)).resolves.toMatchObject({saved:true});
 expect(fixture.calls[0].args).toEqual(fixture.calls[1].args);
 expect(fixture.calls[0].args.p_rows).toEqual([
  {nama_obat:'Obat',item_id:'action-sku',qty:1,satuan:'pcs',faktor:1,harga:100,aturan_pakai:null,jenis:'obat',kategori:null},
  {nama_obat:'Jasa lama',item_id:'action-sku',qty:1,satuan:'pcs',faktor:1,harga:100,aturan_pakai:null,jenis:'jasa',kategori:null},
 ]);
});
