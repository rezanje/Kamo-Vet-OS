import {expect,it,vi} from 'vitest';
const s=vi.hoisted(()=>({calls:[] as {name:string;args:Record<string,unknown>}[]}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('next/navigation',()=>({redirect:(p:string)=>{throw Error(p)}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:async(name:string,args:Record<string,unknown>)=>{s.calls.push({name,args});return{data:'record',error:null}}})}));
import {koreksiRekamMedisLengkap} from '@/app/(app)/klinik/rekam-medis/[visitId]/actions';
it('saves ordinary rows IDs and normalized BMHP through full edit RPC not initial save',async()=>{
 const f=new FormData();for(const [k,v]of Object.entries({visitId:'visit',medical_record_id:'record',expected_revision:'2',request_key:'full',correction_reason:'Fiktif',anamnesis:'Saved',suhu:'38.25',resep:JSON.stringify([{prescription_item_id:'rx',nama_obat:'Tindakan',item_id:'sku',jenis:'obat',qty:2,harga:100,satuan:'pcs',bmhp:[{item_id:'mat',nama:'untrusted',qty:3,unit:'ml'}]}])}))f.set(k,v);
 expect(await koreksiRekamMedisLengkap(f)).toEqual({saved:true,href:'/klinik/rekam-medis/visit?success=correction'});
 expect(s.calls).toEqual([{name:'clinic_edit_queued_record',args:expect.objectContaining({p_record_id:'record',p_expected_revision:2,p_rows:[expect.objectContaining({prescription_item_id:'rx',bmhp_components:[{item_id:'mat',qty:3,unit:'ml'}]})]})}]);
});
