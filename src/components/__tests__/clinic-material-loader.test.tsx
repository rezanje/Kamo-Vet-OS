// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('next/link',()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock('next/navigation',()=>({redirect:(url:string)=>{throw new Error(`REDIRECT:${url}`)}}));
vi.mock('@/app/(app)/klinik/bahan-baku/actions',()=>({setBahanBaku:vi.fn(),setBahanBakuBanyak:vi.fn()}));
const db=vi.hoisted(()=>({role:'OWNER',user:true,fail:'',requests:[] as {table:string;from?:number}[]}));
const categories=[{id:'parent',name:'Obat Klinik',parent_id:null,is_active:true},{id:'child',name:'Anestesi / Sedasi',parent_id:'parent',is_active:true},...Array.from({length:1003},(_,i)=>({id:`cat${i}`,name:`Kategori ${i}`,parent_id:null,is_active:true}))];
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:db.user?{id:'fixture-owner'}:null}})},from(table:string){
 const request={table} as {table:string;from?:number};db.requests.push(request);let from=0,to=999;const filters:Record<string,unknown>={};
 const q={select(){return q},eq(key:string,value:unknown){filters[key]=value;return q},is(key:string,value:unknown){filters[key]=value;return q},order(){return q},range(a:number,b:number){from=a;to=b;request.from=a;return q},single:async()=>({data:{role:db.role}}),then(resolve:(value:unknown)=>unknown){
  const all=table==='item_categories'?categories:table==='items'?[...Array.from({length:1205},(_,i)=>({id:`i${i}`,code:`QA-${i}`,name:i===1204?'Fiction sedasi beyond thousand':`Fiction item ${i}`,sell_price:12.75,is_compound_material:i===1204,category_id:'child',item_type:'Persediaan',is_active:true,trashed_at:null,item_categories:{name:'Anestesi / Sedasi'}})),{id:'service',name:'Service excluded',item_type:'Jasa',is_active:true,trashed_at:null},{id:'inactive',name:'Inactive excluded',item_type:'Persediaan',is_active:false,trashed_at:null}].filter(row=>Object.entries(filters).every(([key,value])=>row[key as keyof typeof row]===value)):[];
  return Promise.resolve({data:db.fail===table?null:all.slice(from,to+1),count:all.length,error:db.fail===table?{message:'fixture database failure'}:null}).then(resolve)
 }};return q;}})}));
import Page from '@/app/(app)/klinik/bahan-baku/page';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});db.role='OWNER';db.user=true;db.fail='';db.requests=[];host=document.createElement('div');document.body.append(host);root=createRoot(host)});
afterEach(async()=>{await act(async()=>root.unmount());host.remove()});
it('loads eligible material and category pages beyond the default1000 without including services/inactive items',async()=>{
 const page=await Page();await act(async()=>root.render(page));
 expect(host.textContent).toContain('Fiction sedasi beyond thousand');
 expect(host.querySelectorAll('select[aria-label="Kategori induk"] option')).toHaveLength(1006);
 expect(db.requests.some(r=>r.table==='items'&&r.from===1000)).toBe(true);
 expect(db.requests.some(r=>r.table==='item_categories'&&r.from===1000)).toBe(true);
 expect(host.textContent).not.toContain('Service excluded');expect(host.textContent).not.toContain('Inactive excluded');
});
it.each(['items','item_categories'])('shows a load error instead of an editable empty/partial list when %s fails',async table=>{
 db.fail=table;const page=await Page();await act(async()=>root.render(page));
 expect(host.querySelector('[role=alert]')?.textContent).toContain('belum dapat dimuat lengkap');
 expect(host.querySelector('input[type=checkbox]')).toBeNull();
});
it.each(['STAFF','DOCTOR'])('preserves the existing admin-only role gate for %s',async role=>{db.role=role;await expect(Page()).rejects.toThrow('REDIRECT:/klinik');expect(db.requests.some(r=>r.table==='items'||r.table==='item_categories')).toBe(false)});
it('redirects an anonymous user before loading any catalog',async()=>{db.user=false;await expect(Page()).rejects.toThrow('REDIRECT:/login');expect(db.requests).toEqual([])});
