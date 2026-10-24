import {beforeEach,expect,it,vi} from 'vitest';
const s=vi.hoisted(()=>({user:'owner',legacy:false,writes:[] as string[]}));
const run='11111111-1111-4111-8111-111111111111';
vi.mock('next/navigation',()=>({redirect:()=>{throw Error('UNEXPECTED_REDIRECT')}}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:s.user}}})},from(table:string){
 const filters:((r:Record<string,unknown>)=>boolean)[]=[];let first=0,last=999;
 const rows=()=>table==='profiles'?[{id:s.user,role:'OWNER',is_active:true}]:table==='import_runs'?[{id:run,created_by:'owner',kind:'initial_stock',status:'previewed',summary:{source_qty:2,source_value:1.01},branch_id:'branch',warehouse_id:'wh',as_of_date:'2026-01-01'}]:table==='import_run_rows'?[{run_id:run,source_row:2,source_code:'F-A',status:'valid',reason:null,payload:{base_qty:'1.000000000000000001',base_unit_cost:'0.01',item_id:'item-A',unit:'PCS',...(s.legacy?{}:{source_values:[{qty:'1.000000000000000001',unit_cost:'0.01',factor:'1',unit:'PCS'}]})}},{run_id:run,source_row:3,source_code:'F-B',status:'valid',reason:null,payload:{base_qty:'1',base_unit_cost:'0.99999999999999999999',item_id:'item-B',unit:'PCS',...(s.legacy?{}:{source_values:[{qty:'1',unit_cost:'1',factor:'1',unit:'PCS'}]})}}]:[];
 const data=()=>rows().filter(r=>filters.every(f=>f(r))).slice(first,last+1);
 const q={select:()=>q,eq:(k:string,v:unknown)=>{filters.push(r=>r[k]===v);return q},order:()=>q,range:(a:number,b:number)=>{first=a;last=b;return q},maybeSingle:async()=>({data:data()[0]??null,error:null}),then:(done:(v:unknown)=>unknown)=>Promise.resolve({data:data(),error:null}).then(done),insert:()=>{s.writes.push(table);return q},update:()=>{s.writes.push(table);return q},delete:()=>{s.writes.push(table);return q}};return q;
 },rpc:async(name:string)=>{s.writes.push(name);return {data:null,error:null}}})}));
import {recoverInitialStock} from '@/app/(app)/pos/sku/impor/actions';
beforeEach(()=>{s.user='owner';s.legacy=false;s.writes=[]});
it('recovers exact persisted quantities and full source delta without number rounding or stock/journal writes',async()=>{
 const result=await recoverInitialStock(run);expect(result.ok).toBe(true);expect(result.rows[0].baseQtyExact).toBe('1.000000000000000001');
 expect(result.decimal_preview).toMatchObject({quantity:'2.000000000000000001',source_value:'1.01000000000000000001',rounded_value:'1.01',rounding_delta:'-0.00000000000000000001',source_evidence_complete:true});expect(s.writes).toEqual([]);
});
it('does not label old saved rows without raw evidence as full-precision source data',async()=>{s.legacy=true;const result=await recoverInitialStock(run);expect(result.ok).toBe(true);expect(result.decimal_preview?.source_evidence_complete).toBe(false);expect(s.writes).toEqual([])});
it('retains own-account recovery denial',async()=>{s.user='other';expect((await recoverInitialStock(run)).ok).toBe(false);expect(s.writes).toEqual([])});
