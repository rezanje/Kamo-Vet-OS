import{beforeEach,expect,it,vi}from'vitest';
const state=vi.hoisted(()=>({calls:[]as{name:string;args:Record<string,unknown>}[],error:null as unknown,paths:[]as string[]}));
vi.mock('next/cache',()=>({revalidatePath:(p:string)=>state.paths.push(p)}));
vi.mock('next/navigation',()=>({redirect:(p:string)=>{throw new Error('REDIRECT '+p)}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:async(name:string,args:Record<string,unknown>)=>{state.calls.push({name,args});return{data:'addendum',error:state.error}}})}));
import{tambahAdendumRekamMedis}from'@/app/(app)/klinik/rekam-medis/[visitId]/actions';
const V='11111111-1111-4111-8111-111111111111',R='22222222-2222-4222-8222-222222222222';
beforeEach(()=>{state.calls=[];state.error=null;state.paths=[]});
function form(extra:Record<string,string>={}){const f=new FormData();for(const[k,v]of Object.entries({visitId:V,medical_record_id:R,draft_key:'stable-key',draft_scope:'clinical-addendum',diagnosis_addendum:' Diagnosa tambahan ',therapy_addendum:'',reason:'',total:'1',qty:'9',...extra}))f.set(k,v);return f}
it('appends only diagnosis/therapy text to the exact visit and record, never billing fields',async()=>{
 await expect(tambahAdendumRekamMedis(form())).rejects.toThrow(`REDIRECT /klinik/rekam-medis/${V}?success=addendum`);
 expect(state.calls).toEqual([{name:'clinic_add_record_addendum',args:{p_visit_id:V,p_record_id:R,p_diagnosis:'Diagnosa tambahan',p_therapy:null,p_reason:null,p_request_key:'stable-key'}}]);
 expect(state.paths).toContain(`/klinik/rekam-medis/${V}/dokumen`);
});
it('rejects an empty addendum or malformed identity without calling the database',async()=>{
 await expect(tambahAdendumRekamMedis(form({diagnosis_addendum:'  '}))).rejects.toThrow('error=');
 await expect(tambahAdendumRekamMedis(form({visitId:'visit'}))).rejects.toThrow('error=');
 expect(state.calls).toEqual([]);
});
it('surfaces a database rejection (e.g. other branch) without success acknowledgement',async()=>{
 state.error={message:'Akses adendum rekam medis ditolak'};
 await expect(tambahAdendumRekamMedis(form())).rejects.toThrow('error=');expect(state.paths).toEqual([]);
});
