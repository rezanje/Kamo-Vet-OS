// @vitest-environment jsdom
import {act} from 'react';import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams()}));
vi.mock('@/app/(app)/crm/promo/actions',()=>({editPromo:vi.fn()}));
const db=vi.hoisted(()=>({role:'OWNER',active:true,error:'',requests:[] as {table:string;ids?:string[];from?:number;to?:number;active?:boolean}[],rpc:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'owner'}}})},rpc:db.rpc,from(table:string){
 const req:{table:string;ids?:string[];from?:number;to?:number;active?:boolean}={table};db.requests.push(req);
 const q={select(){return q},eq(key:string,value:boolean){if(key==='is_active')req.active=value;return q},in(key:string,ids:string[]){if(key==='id')req.ids=ids;return q},order(){return q},range(from:number,to:number){req.from=from;req.to=to;return q},maybeSingle:async()=>({data:{role:db.role,is_active:db.active}}),then(resolve:(v:unknown)=>unknown){
 let rows:Record<string,unknown>[]=table==='items'?Array.from({length:1003},(_,i)=>({id:`i${i}`,code:`I${i}`,name:`Fiction ${i}`,category_id:null,is_active:true})).concat([{id:'old',code:'OLD',name:'Archived fixture',category_id:null,is_active:false}]):table==='branches'?[{id:'old-branch',code:'OLD',name:'Archived branch',is_active:false}]:[];
 if(req.active!==undefined)rows=rows.filter(r=>r.is_active===req.active);if(req.ids)rows=rows.filter(r=>req.ids!.includes(String(r.id)));
 return Promise.resolve({data:rows.slice(req.from??0,req.to===undefined?1000:req.to+1),count:rows.length,error:table===db.error?{message:'private fixture error'}:null}).then(resolve);
 }};return q;
}})}));
import Page from '@/app/(app)/crm/promo/[id]/edit/page';
import {ActivityNavigationProvider} from '@/components/ActivityHistoryLink';
const id='a0000000-0000-4000-8000-000000000001';
const snapshot={version:'a'.repeat(32),item_ids:['old','unavailable'],promo:{id,name:'Saved fixture promo',promo_type:'diskon_produk',rule:{suggest:'Reminder'},is_active:false,branch_ids:['old-branch'],valid_from:null,valid_until:null,min_qty:null,max_qty:null,kelipatan:false,auto_apply:false,discount_type:null,discount_value:null}};
let host:HTMLDivElement,root:Root;
async function render(){const page=await Page({params:Promise.resolve({id})});await act(async()=>root.render(<ActivityNavigationProvider allowed>{page}</ActivityNavigationProvider>));}
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();db.role='OWNER';db.active=true;db.error='';db.requests=[];db.rpc.mockReset();db.rpc.mockResolvedValue({data:snapshot,error:null});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('opens the exact stored promo, checked full catalogs, old targets, back and existing object-history link',async()=>{await render();expect(db.rpc).toHaveBeenCalledWith('read_promo_edit',{p_id:id});expect(host.textContent).toContain('Nonaktif');expect(host.textContent).toContain('Archived fixture');expect(host.textContent).toContain('Barang target lama tidak tersedia');expect(db.requests.some(r=>r.table==='items'&&r.from===1000)).toBe(true);expect(db.requests.filter(r=>r.ids).map(r=>r.ids)).toEqual([['old','unavailable'],['old-branch']]);expect(host.querySelector('a[href="/crm/promo"]')).not.toBeNull();expect(host.querySelector('a[href*="entity=promos"]')!.getAttribute('href')).toContain(`object=${id}`);const f=new FormData(host.querySelector('form')!);expect(f.getAll('item_ids')).toEqual(['old','unavailable']);expect(f.getAll('branch_ids')).toEqual(['old-branch']);});
it.each(['STAFF','DOCTOR','FINANCE'])('does not load editor data for %s',async(role)=>{db.role=role;await render();expect(db.rpc).not.toHaveBeenCalled();expect(db.requests.every(r=>r.table==='profiles')).toBe(true);expect(host.querySelector('form')).toBeNull();});
it('does not load editor for inactive managers',async()=>{db.active=false;await render();expect(db.rpc).not.toHaveBeenCalled();expect(host.querySelector('form')).toBeNull();});
it('fails closed on RPC or incomplete catalog reads without exposing raw database errors',async()=>{db.rpc.mockResolvedValue({error:{message:'private failure'}});await render();expect(host.querySelector('form')).toBeNull();expect(host.textContent).not.toContain('private');db.rpc.mockResolvedValue({data:snapshot,error:null});db.error='items';await render();expect(host.querySelector('form')).toBeNull();expect(host.textContent).toContain('belum dapat dimuat lengkap');expect(host.textContent).not.toContain('private fixture');});
