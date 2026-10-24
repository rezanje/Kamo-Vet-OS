import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,expect,it,vi} from 'vitest';

const {state,client}=vi.hoisted(()=>({state:{rows:[] as Record<string,unknown>[],visible:[] as string[],calls:[] as unknown[][],sourceError:false,role:'OWNER'},client:{from:vi.fn(),auth:{getUser:async()=>({data:{user:{id:'owner'}}})}}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>client}));
import ActivityLogPage from '@/app/(app)/perusahaan/log-aktifitas/page';
const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
function event(patch:Record<string,unknown>={}){return {id:1,occurred_at:'2026-10-22T03:15:00Z',actor_id:'actor-from-server',actor_name:'Petugas contoh',actor_kind:'user',module_id:'pembelian',entity:'purchase_orders',entity_id:a,object_label:'PO-TEST',row_entity:'purchase_order_items',row_id:b,action:'update',changed_fields:['qty','harga_beli'],before_state:{qty:2,harga_beli:10000.25},after_state:{qty:3,harga_beli:12000.5},...patch};}
beforeEach(()=>{
 state.rows=[event()];state.visible=[a];state.calls=[];state.sourceError=false;state.role='OWNER';
 client.from.mockImplementation((table:string)=>{
  let ids:string[]=[];
  const query:Record<string,unknown>={then:(resolve:(r:unknown)=>unknown)=>{
   if(table==='profiles')return resolve({data:{role:state.role,is_active:true}});
   if(table==='activity_log')return resolve({data:state.rows,error:null});
   return resolve(state.sourceError?{data:null,error:{message:'private source failure'}}:{data:ids.filter(id=>state.visible.includes(id)).map(id=>({id})),error:null});
  }};
  for(const method of ['select','eq','contains','order','limit','maybeSingle','lt','gt','gte','lte','ilike','in'])query[method]=(...args:unknown[])=>{state.calls.push([table,method,...args]);if(method==='in')ids=args[1] as string[];return query;};
  return query;
 });
});
const render=async(params:Record<string,string>={})=>renderToStaticMarkup(await ActivityLogPage({searchParams:Promise.resolve(params)}));

it('explains quantity and price changes with localized labels and exact decimals',async()=>{
 const html=await render();
 expect(html).toContain('Petugas contoh');expect(html).toContain('10.15');
 expect(html).toContain('Jumlah');expect(html).toContain('Harga beli');
 expect(html).toContain('Sebelum:');expect(html).toContain('Sesudah:');
 expect(html).toContain('10.000,25');expect(html).toContain('12.000,5');
 expect(html).not.toContain('<code>harga_beli</code>');
});
it('keeps refund history scoped to its exact object and exposes a readable entity filter',async()=>{
 state.rows=[event({module_id:'kas-bank',entity:'sales_refund_requests',row_entity:'sales_refund_requests',row_id:a,changed_fields:['metadata']})];
 const html=await render({entity:'sales_refund_requests',object:a});
 expect(state.calls).toContainEqual(['activity_log','contains','object_refs',[{entity:'sales_refund_requests',id:a}]]);
 expect(html).toContain('Permintaan pengembalian dana penjualan');
 expect(html).toContain('entity=sales_refund_requests&amp;object='+a);
 expect(html).not.toContain('Sumber: sales_refund_requests');
});
it('opens the supported source header from a child event only after a session-visible source read',async()=>{
 const html=await render();
 expect(html).toContain('href="/pembelian/'+a+'"');expect(html).toContain('Buka transaksi asal');
 expect(state.calls).toContainEqual(['purchase_orders','in','id',[a]]);
 expect(html).not.toContain('/pembelian/'+b+'"');
});
it('does not link a source hidden by current branch access, while retaining its audit row',async()=>{
 state.visible=[];
 const html=await render();
 expect(html).toContain('PO-TEST');expect(html).not.toContain('href="/pembelian/'+a+'"');
});
it('uses only visible returned source IDs when a page contains multiple branches',async()=>{
 state.rows=[event(),event({id:2,entity_id:b,object_label:'PO-OTHER-BRANCH'})];
 const html=await render();
 expect(html).toContain('href="/pembelian/'+a+'"');expect(html).not.toContain('href="/pembelian/'+b+'"');
 expect(html).toContain('PO-OTHER-BRANCH');
});
it('retains deleted history without querying or linking a possibly reused source identity',async()=>{
 state.rows=[event({action:'delete'})];
 const html=await render();
 expect(html).toContain('Dihapus');expect(html).toContain('PO-TEST');
 expect(html).not.toContain('Buka transaksi asal');
 expect(state.calls.some(c=>c[0]==='purchase_orders')).toBe(false);
});
it('fails closed on source lookup errors without erasing history or exposing internal errors',async()=>{
 state.sourceError=true;const html=await render();
 expect(html).toContain('PO-TEST');expect(html).not.toContain('Buka transaksi asal');
 expect(html).toContain('Tautan transaksi asal belum dapat diperiksa');
 expect(html).not.toContain('private source failure');
});
it.each(['employee_salary_components','medical_records'])('preserves metadata-only privacy for %s even if a payload is present',async entity=>{
 state.rows=[event({entity,row_entity:entity,changed_fields:['metadata'],before_state:{salary:1234567,notes:'private-note'},after_state:{salary:7654321,notes:'private-note-new'}})];
 const html=await render();
 expect(html).toContain('rincian isi disamarkan');
 expect(html).not.toContain('1234567');expect(html).not.toContain('7654321');expect(html).not.toContain('private-note');
 expect(html).not.toContain('Buka transaksi asal');
});
it('does not turn unknown fields, nested payloads or malformed source IDs into display values or links',async()=>{
 state.rows=[event({entity_id:'../admin?next=evil',changed_fields:['opaque_payload'],before_state:{opaque_payload:{secret:'PRIVATE'}},after_state:{opaque_payload:'PRIVATE'}})];
 const html=await render();
 expect(html).not.toContain('PRIVATE');expect(html).not.toContain('<code>opaque_payload</code>');
 expect(html).not.toContain('Buka transaksi asal');
 expect(state.calls.some(c=>c[0]==='purchase_orders')).toBe(false);
});
