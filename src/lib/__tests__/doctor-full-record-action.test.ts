import {beforeEach,expect,it,vi} from 'vitest';
const s=vi.hoisted(()=>({calls:[] as {name:string;args:Record<string,unknown>}[],error:null as null|{message:string}}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('next/navigation',()=>({redirect:(p:string)=>{throw Error(p)}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:async(name:string,args:Record<string,unknown>)=>{s.calls.push({name,args});return{data:s.error?null:'record',error:s.error}}})}));
import {koreksiRekamMedisLengkap} from '@/app/(app)/klinik/rekam-medis/[visitId]/actions';
beforeEach(()=>{s.calls=[];s.error=null});
function form(){
 const f=new FormData();for(const [k,v]of Object.entries({visitId:'visit',medical_record_id:'record',expected_revision:'2',request_key:'full',correction_reason:'Fiktif',anamnesis:'Saved',suhu:'38.25',resep:JSON.stringify([{prescription_item_id:'rx',nama_obat:'Tindakan',item_id:'sku',jenis:'obat',qty:2,harga:100,satuan:'pcs',service_performers:{doctor_id:'original-doctor',staff_id:null},bmhp:[{item_id:'mat',nama:'untrusted',qty:3,unit:'ml'}]}])}))f.set(k,v);
 return f;
}
it.each(['OWNER','DOCTOR'])('%s positive public RPC response saves IDs BMHP and original attribution without initial-save fallback',async(role)=>{
 const f=form();f.set('role',role); // Client role is deliberately ignored; DB session authorizes.
 expect(await koreksiRekamMedisLengkap(f)).toEqual({saved:true,href:'/klinik/rekam-medis/visit?success=correction'});
 // Every full edit goes through the atomic wrapper (empty p_compounds = ordinary edit).
 expect(s.calls).toEqual([{name:'clinic_edit_queued_record_with_compounds',args:expect.objectContaining({p_record_id:'record',p_expected_revision:2,p_compounds:[],p_rows:[expect.objectContaining({prescription_item_id:'rx',service_performers:{doctor_id:'original-doctor',staff_id:null},bmhp_components:[{item_id:'mat',qty:3,unit:'ml'}]})]})}]);
 expect(s.calls[0].args).not.toHaveProperty('role');
});
it.each(['ACCESS_DENIED','RECORD_POSTED','COMPOUND_LOCKED'])('fails closed on %s without legacy or initial-save fallback',async(message)=>{
 s.error={message};const f=form();f.set('role','OWNER');
 await expect(koreksiRekamMedisLengkap(f)).rejects.toThrow(message);
 expect(s.calls.map(x=>x.name)).toEqual(['clinic_edit_queued_record_with_compounds']);
});
