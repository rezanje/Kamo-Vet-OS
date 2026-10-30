import {expect,it,vi} from 'vitest';
const s=vi.hoisted(()=>({calls:[]as{name:string,args:Record<string,unknown>}[]}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'staff'}}})},rpc:async(name:string,args:Record<string,unknown>)=>{s.calls.push({name,args});return{data:{status:'SAVED',visit_id:'visit',record_id:'stay',invoice_id:'invoice'},error:null}}})}));
vi.mock('@/lib/shift',()=>({getOpenShift:async()=>({id:'shift'})}));
vi.mock('@/lib/jurnal-guard',()=>({cekPeriode:async()=>null}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
import {simpanBayar} from '@/app/(app)/klinik/rawat-inap/[id]/tagihan/actions';
it('submits current isolated inpatient draft snapshot through atomic editable wrapper and returns main cashier formal document context',async()=>{
 const f=new FormData();for(const[k,v]of Object.entries({recordId:'stay',visitId:'visit',requestKey:'request',parts:'[]',pending_snapshot:'snapshot',pending_rows:'[{"id":"rx","qty":2}]',cart_reason:'Fiktif'}))f.set(k,v);
 const result=await simpanBayar(f);
 expect(s.calls[0]).toMatchObject({name:'clinic_save_inpatient_cashier',args:{p_snapshot:'snapshot',p_rows:[{id:'rx',qty:2}],p_reason:'Fiktif'}});
 expect(result).toMatchObject({status:'SAVED',href:expect.stringContaining('/klinik/pembayaran/visit?')});
});
