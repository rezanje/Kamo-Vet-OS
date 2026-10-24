import {beforeEach,expect,it,vi}from 'vitest';
const s=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>s}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('next/navigation',()=>({redirect:(url:string)=>{throw Error(url);}}));
import * as actions from '@/app/(app)/pembelian/actions';
const id='d6400000-0000-4000-8000-000000000001';
const form=()=>{const f=new FormData();Object.entries({id,revision:'2',draft_key:'p05-key',draft_scope:'p05-scope',alasan:'Supplier revised price',items:JSON.stringify([{id:'line',harga_beli:250000}])}).forEach(([k,v])=>f.set(k,v));return f;};
beforeEach(()=>{vi.clearAllMocks();s.rpc.mockResolvedValue({data:{po_id:id,revision:3,action:'edit',mode:'prices',revision_id:'d6500000-0000-4000-8000-000000000099',total:500000},error:null});});
it('submits only price correction and acknowledges the matching durable receipt',async()=>{
 expect(actions.ubahHargaPO).toBeTypeOf('function');
 await expect(actions.ubahHargaPO(form())).rejects.toThrow('draft_done=p05-key');
 expect(s.rpc).toHaveBeenCalledExactlyOnceWith('revise_purchase_order_prices',{p_request_key:'p05-key',p_purchase_order_id:id,p_expected_revision:2,p_items:[{id:'line',harga_beli:250000}],p_reason:'Supplier revised price'});
});
it.each([undefined,{data:null,error:null},{data:{po_id:id},error:null},{data:{po_id:'other',revision:3,mode:'prices'},error:null}])('unknown or mismatched response never claims success',async response=>{
 expect(actions.ubahHargaPO).toBeTypeOf('function');s.rpc.mockResolvedValue(response);
 await expect(actions.ubahHargaPO(form())).rejects.toThrow('belum terkonfirmasi');
});
