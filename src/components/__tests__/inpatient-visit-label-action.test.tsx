// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fx=vi.hoisted(()=>({calls:[] as {name:string;args:Record<string,unknown>}[]}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()}),redirect:(href:string)=>{throw Error(`REDIRECT ${href}`);}}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
// Only the external database boundary is mocked: the rendered form uses the real server action.
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({
 auth:{getUser:async()=>({data:{user:{id:'actor'}}})},
 rpc:async(name:string,args:Record<string,unknown>)=>{fx.calls.push({name,args});return {data:'log',error:null};},
 from(table:string){const q={select:()=>q,eq:()=>q,in:()=>q,
  maybeSingle:async()=>({data:{condition_status:'stabil',visit_id:'visit',medical_record_id:'record'},error:null}),
  then(resolve:(value:unknown)=>void){return Promise.resolve({data:table==='inpatient_records'?[{id:'stay',stay_type:'sakit'}]:[],error:null}).then(resolve);}};return q;},
})}));
import { CatatanForm } from '@/app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm';
import { LogEditForm } from '@/app/(app)/klinik/rawat-inap/[id]/catatan/[logId]/LogEditForm';
let host:HTMLDivElement;let root:Root;
const patient={name:'Fiktif',species:'Kucing',breed:null,noRM:'FIKTIF',owner:'Fiktif',phone:'',address:'',tglMasuk:'-',dokter:'Fiktif',kondisi:'Stabil',photo:null};
const doctor='dc000000-0000-4000-8000-000000000002';
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();fx.calls=[];host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it.each(['Visit 1','Visit 2'])('rendered %s submits through the real action and remains visible in the existing saved-report view',async label=>{
 await act(async()=>root.render(<CatatanForm mode="clinical" recordId="stay" requestKey="request" draftUserId="actor" backHref="/klinik/rawat-inap/stay" patient={patient}
  items={[]} racikanItems={[]} bahanItems={[]} jasaItems={[]} tindakanItems={[]} katalogRacikan={[]} bolehManual={false} doctors={[{id:doctor,nama:'Drh fiktif',jabatan:'Dokter'}]}/>));
 const form=host.querySelector('form')!;
 const note='Kondisi fiktif\nTetap observasi';form.querySelector<HTMLTextAreaElement>('[name="condition_note"]')!.value=note;
 for(const [name,value] of [['visit_label',label],['visit_doctor_id',doctor]]){
  const field=form.querySelector<HTMLSelectElement>(`[name="${name}"]`)!;
  await act(async()=>{field.value=value;field.dispatchEvent(new Event('change',{bubbles:true}));});
  if(name==='visit_label'){
   expect(form.checkValidity()).toBe(false);
   await act(async()=>form.requestSubmit());expect(fx.calls).toEqual([]);
  }
 }
 await act(async()=>form.requestSubmit());
 expect(fx.calls).toHaveLength(1);
 expect(fx.calls[0]).toMatchObject({name:'clinic_save_inpatient_log_with_status',args:{p_rows:[],p_compounds:[],p_new_status:null,p_log:{condition_note:`${label}\n${note}`,log_kind:'doctor_visit',visit_doctor_id:doctor}}});
 const log=fx.calls[0].args.p_log as {condition_note:string;log_kind:'doctor_visit';visit_doctor_id:string};
 await act(async()=>root.render(<LogEditForm recordId="stay" backHref="/klinik/rawat-inap/stay" patient={patient} editable={false} edits={[]} bolehKoreksiVisit={false}
  log={{...log,id:'log',log_date:'2026-10-30',created_at:'2026-10-30T06:00:00Z',tindakan:null,keterangan:null,doctor_name:'Drh fiktif'}}/>));
 expect(host.querySelector<HTMLTextAreaElement>('[name="condition_note"]')!.value).toBe(`${label}\n${note}`);
 expect(host.querySelector('[name="visit_label"]')).toBeNull();
 expect(host.querySelector<HTMLSelectElement>('[aria-label="Jenis laporan"]')!.disabled).toBe(true);
});
