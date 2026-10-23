import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach,expect,it,vi } from 'vitest';
const pageState=vi.hoisted(()=>({status:'berjalan'}));
beforeEach(()=>{pageState.status='berjalan';});
vi.mock('@/components/LocalTransactionDraft',async original=>({...await original<typeof import('@/components/LocalTransactionDraft')>(),TransactionForm:({children}:{children:React.ReactNode})=><form>{children}</form>}));
vi.mock('@/components/ProductionRequestIdentity',()=>({ProductionRequestIdentity:({kind,mode='recipe'}:{kind:string;mode?:string})=><><input name="request_key" value={kind} readOnly/><input name="production_mode" value={mode} readOnly/></>}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'actor'}}})},rpc:async()=>({data:{p:{recipe_name:'Frozen recipe',output_name:'Frozen output',unit:'PCS',planned_qty:2,materials:[{nama:'Frozen material',warehouse_name:'Frozen source warehouse',qty:1,unit:'PCS',cost:0.3125}]}},error:null}),from(table:string){const data=table==='production_recipes'?[{id:'r',nama:'Fiction',output_qty:1,items:{unit:'PCS',name:'Output'},production_recipe_items:[]}]:table==='production_orders'?[{id:'p',no_produksi:'PRD.FICTION',batch:1,nilai_bahan:0.3125,qty_jadi:0,status:pageState.status,production_recipes:pageState.status==='selesai'?null:{nama:'Fiction',output_qty:1,items:{unit:'PCS'}}}]:[];const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,limit:()=>q,range:()=>q,then(resolve:(x:unknown)=>unknown){return Promise.resolve({data,error:null,count:data.length}).then(resolve);}};return q;}})}));
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
it('offers an ad hoc job path independently from master recipe configuration',async()=>{
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));
 expect(html).toContain('PEKERJAAN AD HOC');expect(html).toContain('name="production_mode" value="adhoc"');
});

it('retains frozen job, output and source details in completed ad hoc history',async()=>{
 pageState.status='selesai';const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));
 expect(html).toContain('Frozen recipe');expect(html).toContain('Frozen output');expect(html).toContain('Frozen material');expect(html).toContain('Frozen source warehouse');
});
