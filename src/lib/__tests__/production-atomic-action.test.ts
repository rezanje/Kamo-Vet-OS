import { beforeEach, expect, it, vi } from 'vitest';
const s = vi.hoisted(()=>({stock:0,status:'berjalan',rpc:[] as unknown[],failure:true,mode:''}));
vi.mock('next/navigation',()=>({redirect:(url:string)=>{throw Error(decodeURIComponent(url));}}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/lib/inventory',()=>({stockIn:async()=>{s.stock++;},stockOut:async()=>({cost:100})}));
vi.mock('@/lib/posting',()=>({postJournal:async()=>{throw Error('Fictional journal failure');}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({
 auth:{getUser:async()=>({data:{user:{id:'actor'}}})},
 rpc:async(name:string,args:Record<string,unknown>)=>{s.rpc.push({name,args});if(s.mode==='transport')throw Error('Synthetic private transport details');return s.failure?{data:null,error:{code:'P0001',message:'Fictional journal failure'}}:{data:s.mode==='empty'?null:{order_id:'10000000-0000-4000-8000-000000000001',no_produksi:'PRD.FICTION',kind:args.p_kind,tanggal:s.mode==='wrong-date'?'2026-10-21':'2026-10-23',value:0.3125,journal_id:'20000000-0000-4000-8000-000000000002',already_posted:name==='get_production_atomic_result'},error:null};},
 from(table:string){const q={select:()=>q,eq:()=>q,maybeSingle:()=>q,update:()=>{s.status='selesai';return q;},then(resolve:(x:unknown)=>unknown){return Promise.resolve({data:table==='profiles'?{role:'OWNER',is_active:true}:table==='production_orders'?{id:'10000000-0000-4000-8000-000000000001',no_produksi:'PRD.FICTION',status:'berjalan',warehouse_id:'wh',nilai_bahan:100,production_recipes:{nama:'Fiction recipe',item_id:'item'}}:null,error:null}).then(resolve);}};return q;},
})}));
import { selesaikanProduksi,mulaiProduksi,recoverProductionPosting } from '@/app/(app)/pos/produksi/actions';
beforeEach(()=>{s.stock=0;s.status='berjalan';s.rpc=[];s.failure=true;s.mode='';});
it('leaves no completed stock/status when the completion journal fails',async()=>{
 const f=new FormData();f.set('id','10000000-0000-4000-8000-000000000001');f.set('qty_jadi','2');f.set('tanggal_selesai','2026-10-23');f.set('request_key','fiction-key');
 await expect(selesaikanProduksi(f)).rejects.toThrow();
 expect(s.stock).toBe(0);expect(s.status).toBe('berjalan');
});

const completion=()=>{const f=new FormData();f.set('id','10000000-0000-4000-8000-000000000001');f.set('qty_jadi','3');f.set('tanggal_selesai','2026-10-23');f.set('request_key','fiction-key');f.set('production_kind','finish');return f;};
it('uses exactly one guarded completion transaction before acknowledging the local draft',async()=>{
 s.failure=false;const f=completion();f.set('draft_key','draft-original');f.set('draft_scope','production-complete');
 await expect(selesaikanProduksi(f)).rejects.toThrow('request_done=fiction-key');
 expect(s.rpc).toEqual([{name:'post_production_atomic',args:{p_kind:'finish',p_request_key:'fiction-key',p_input:{id:'10000000-0000-4000-8000-000000000001',qty_jadi:'3',tanggal_selesai:'2026-10-23'}}}]);
});
it.each(['empty','transport','wrong-date'])('does not acknowledge uncertain %s completion',async mode=>{
 s.failure=false;s.mode=mode;await expect(selesaikanProduksi(completion())).rejects.toThrow(/belum dapat dipastikan/);expect(s.rpc).toHaveLength(1);
});
it('recovers only through the receipt reader without posting again',async()=>{
 s.failure=false;await expect(recoverProductionPosting(completion())).rejects.toThrow('tidak ada posting ulang');
 expect(s.rpc).toEqual([{name:'get_production_atomic_result',args:{p_kind:'finish',p_request_key:'fiction-key',p_order_id:'10000000-0000-4000-8000-000000000001'}}]);
});
it('retains the exact decimal batch submitted to the start transaction',async()=>{
 s.failure=false;const f=new FormData();f.set('recipe_id','30000000-0000-4000-8000-000000000003');f.set('warehouse_id','40000000-0000-4000-8000-000000000004');f.set('batch','0.1234567890123456789');f.set('tanggal','2026-10-23');f.set('request_key','start-key');
 await expect(mulaiProduksi(f)).rejects.toThrow('request_done=start-key');
 expect(s.rpc[0]).toMatchObject({args:{p_input:{batch:'0.1234567890123456789'}}});
});
