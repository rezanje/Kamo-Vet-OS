// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {it,expect,vi} from 'vitest';
vi.mock('next/link',()=>({default:({children,...p}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...p}>{children}</a>}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams()}));
vi.mock('@/app/(app)/crm/promo/actions',()=>({createPromo:vi.fn(),togglePromo:vi.fn()}));
const db=vi.hoisted(()=>({user:'owner',requests:[] as {table:string;from?:number;active?:boolean}[]}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:db.user}}})},from(table:string){const req={table} as {table:string;from?:number;to?:number;active?:boolean};db.requests.push(req);const q={select(){return q}, maybeSingle:async()=>({data:{role:"OWNER",is_active:true}}),eq(key:string,value:boolean){if(key==='is_active')req.active=value;return q},order(){return q},range(from:number,to:number){req.from=from;req.to=to;return q},then(resolve:(x:unknown)=>unknown){const rows=table==='items'?Array.from({length:1205},(_,i)=>({id:'i'+i,code:'CODE-'+i,name:i===1204?'Needle after thousand':'Fiction item'})):table==='branches'?[{id:'b1',code:'B1',name:'Fiction branch'}]:[];return Promise.resolve({data:rows.slice(req.from??0,req.to===undefined?1000:req.to+1),count:rows.length,error:null}).then(resolve)}};return q;}})}));
import Page from '@/app/(app)/crm/promo/page';
it('loads active CRM choices beyond1000 and exposes searchable item/branch controls',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();const h=document.createElement('div');document.body.append(h);const r=createRoot(h);
 try{const page=await Page({searchParams:Promise.resolve({})});await act(async()=>r.render(page));
 const search=h.querySelector<HTMLInputElement>('input[aria-label="Cari barang promo"]');expect(search).not.toBeNull();
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'CODE-1204');search!.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(h.textContent).toContain('Needle after thousand');expect(db.requests.some(x=>x.table==='items'&&x.from===1000&&x.active===true)).toBe(true);
 }finally{await act(async()=>r.unmount());h.remove();}
});

it('separates form fields and selected targets when the authenticated account changes',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();db.user='owner';const h=document.createElement('div');document.body.append(h);const r=createRoot(h);
 const render=async()=>{const page=await Page({searchParams:Promise.resolve({})});await act(async()=>r.render(page));};
 try{await render();
 const name=h.querySelector<HTMLInputElement>('input[name="name"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(name,'Owner draft');name.dispatchEvent(new Event('input',{bubbles:true}));});
 const search=h.querySelector<HTMLInputElement>('input[aria-label="Cari barang promo"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'CODE-1204');search.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>h.querySelector<HTMLButtonElement>('[role="option"]')!.click());
 expect(h.querySelectorAll('input[name="item_ids"]')).toHaveLength(1);
 db.user='other';await render();
 expect(h.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe('');
 expect(h.querySelectorAll('input[name="item_ids"]')).toHaveLength(0);
 db.user='owner';await render();
 expect(h.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe('Owner draft');
 expect(h.querySelector<HTMLInputElement>('input[name="item_ids"]')!.value).toBe('i1204');
 }finally{await act(async()=>r.unmount());h.remove();db.user='owner';}
});
