import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach,expect,it,vi } from 'vitest';
const pageState=vi.hoisted(()=>({status:'berjalan',selectedProof:true,selectedError:false,sourceError:false,selectedFilter:'',selectedNumber:'PRD.2026.10.00001',listNumber:'PRD.FICTION'}));
beforeEach(()=>{pageState.status='berjalan';pageState.selectedProof=true;pageState.selectedError=false;pageState.sourceError=false;pageState.selectedFilter='';pageState.selectedNumber='PRD.2026.10.00001';pageState.listNumber='PRD.FICTION';});
vi.mock('@/components/LocalTransactionDraft',async original=>({...await original<typeof import('@/components/LocalTransactionDraft')>(),TransactionForm:({children}:{children:React.ReactNode})=><form>{children}</form>}));
vi.mock('@/components/ProductionRequestIdentity',()=>({ProductionRequestIdentity:({kind,mode='recipe'}:{kind:string;mode?:string})=><><input name="request_key" value={kind} readOnly/><input name="production_mode" value={mode} readOnly/></>}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'actor'}}})},rpc:async(_name:string,args:{p_order_ids:string[]})=>({data:{p:{recipe_name:'Frozen recipe',output_name:'Frozen output',unit:'PCS',planned_qty:2,materials:[{nama:'Frozen material',warehouse_name:'Frozen source warehouse',qty:1,unit:'PCS',cost:0.3125}]},...(pageState.selectedProof&&args.p_order_ids.includes('10000000-0000-4000-8000-000000000001')?{'10000000-0000-4000-8000-000000000001':{recipe_name:'Old frozen job',output_name:'Old frozen output',unit:'PCS',planned_qty:3,materials:[{nama:'Old material',qty:2}]}}:{})},error:pageState.sourceError?{message:'private'}:null}),from(table:string){const data=table==='production_recipes'?[{id:'r',nama:'Fiction',output_qty:1,items:{unit:'PCS',name:'Output'},production_recipe_items:[]}]:table==='production_orders'?[{id:'p',no_produksi:pageState.listNumber,batch:1,nilai_bahan:0.3125,qty_jadi:0,status:pageState.status,production_recipes:pageState.status==='selesai'?null:{nama:'Fiction',output_qty:1,items:{unit:'PCS'}}}]:[];const q={select:()=>q,eq:(key:string,value:string)=>{if(table==='production_orders'&&key==='no_produksi')pageState.selectedFilter=value;return q;},in:()=>q,order:()=>q,limit:()=>q,range:()=>q,maybeSingle:async()=>({data:pageState.selectedError?null:{id:'10000000-0000-4000-8000-000000000001',no_produksi:pageState.selectedNumber,batch:1,qty_jadi:3,nilai_bahan:30,status:'selesai',tanggal:'2026-10-23',tanggal_selesai:'2026-10-24',production_recipes:null,warehouses:{name:'Old warehouse'}},error:pageState.selectedError?{message:'private'}:null}),then(resolve:(x:unknown)=>unknown){return Promise.resolve({data,error:null,count:data.length}).then(resolve);}};return q;}})}));
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

it('opens a completed older production order by its saved number outside the recent 50',async()=>{
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({nomor:'PRD.2026.10.00001'})}));
 expect(pageState.selectedFilter).toBe('PRD.2026.10.00001');
 expect(html).toContain('id="selected-production"');
 expect(html).toContain('Old frozen job');
 expect(html).toContain('Old material');
 expect(html).toContain('PRD.2026.10.00001');
});

it('does not expose selected order details without branch-scoped source proof',async()=>{
 pageState.selectedProof=false;
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({nomor:'PRD.2026.10.00001'})}));
 expect(html).toContain('Pekerjaan tidak tersedia untuk akses Anda');
 expect(html).not.toContain('Old frozen job');
 expect(html).not.toContain('Old warehouse');
});

it('reports failed selected-order lookup without treating it as a missing document',async()=>{
 pageState.selectedError=true;
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({nomor:'PRD.2026.10.00001'})}));
 expect(html).toContain('Pekerjaan belum dapat diperiksa');
 expect(html).not.toContain('private');
});

it('opens custom production numbers from the existing POS worklist and selected history',async()=>{
 pageState.listNumber='PROD.2026.10.00002';pageState.selectedNumber='PROD.2026.10.00001';
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({nomor:pageState.selectedNumber})}));
 expect(html).toContain('href="/pos/produksi?nomor=PROD.2026.10.00002#selected-production"');
 expect(pageState.selectedFilter).toBe(pageState.selectedNumber);
 expect(html).toContain('Old frozen job');
});
