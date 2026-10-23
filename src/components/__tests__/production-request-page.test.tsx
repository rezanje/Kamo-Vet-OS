import { renderToStaticMarkup } from 'react-dom/server';
import { expect,it,vi } from 'vitest';
vi.mock('@/components/LocalTransactionDraft',()=>({TransactionForm:({children}:{children:React.ReactNode})=><form>{children}</form>}));
vi.mock('@/components/ProductionRequestIdentity',()=>({ProductionRequestIdentity:({kind}:{kind:string})=><input name="request_key" value={kind} readOnly/>}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'actor'}}})},rpc:async()=>({data:{p:{recipe_name:'Frozen recipe',output_name:'Frozen output',unit:'PCS',planned_qty:2}},error:null}),from(table:string){const data=table==='production_recipes'?[{id:'r',nama:'Fiction',output_qty:1,items:{unit:'PCS',name:'Output'},production_recipe_items:[]}]:table==='production_orders'?[{id:'p',no_produksi:'PRD.FICTION',batch:1,nilai_bahan:0.3125,qty_jadi:0,status:'berjalan',production_recipes:{nama:'Fiction',output_qty:1,items:{unit:'PCS'}}}]:[];const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,limit:()=>q,range:()=>q,then(resolve:(x:unknown)=>unknown){return Promise.resolve({data,error:null,count:data.length}).then(resolve);}};return q;}})}));
vi.mock('@/app/(app)/pos/produksi/ResepForm',()=>({ResepForm:()=>null}));
import Page from '@/app/(app)/pos/produksi/page';
it('provides durable posting identity separately for create and each completion form',async()=>{
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));
 expect(html).toContain('name="request_key" value="start"');
 expect(html).toContain('name="request_key" value="finish"');
});

it('shows the frozen output identity and plan rather than a changed live recipe',async()=>{
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));
 expect(html).toContain('Frozen recipe');expect(html).toContain('Frozen output');
 expect(html).toContain('name="qty_jadi" value="2"');
});

it('does not display sub-cent consumed WIP as zero rupiah',async()=>{
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));
 expect(html).toContain('Rp 0,3125');
});
