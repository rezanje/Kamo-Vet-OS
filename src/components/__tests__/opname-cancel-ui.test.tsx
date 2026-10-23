import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,expect,it,vi} from 'vitest';
const s=vi.hoisted(()=>({status:'Terbuka',locked:0,allowed:null as string[]|null,reads:[] as unknown[][]}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('NOT_FOUND')},redirect:(url:string)=>{throw Error(url)}}));
vi.mock('@/components/ActivityHistoryLink',()=>({ActivityHistoryLink:()=>null}));
vi.mock('@/app/(app)/pos/opname/actions',()=>({batalPerintah:async()=>{}}));
vi.mock('@/app/(app)/pos/opname/[id]/HasilView',()=>({HasilView:()=> <div>POSTED RESULT</div>}));
vi.mock('@/lib/branch-access',()=>({allowedBranchIds:async()=>s.allowed,canUseBranch:()=>true}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'actor'}}})},from(table:string){let single=false;const q={select:(...args:unknown[])=>{s.reads.push([table,'select',...args]);return q},eq:()=>q,order:()=>q,in:(...args:unknown[])=>{s.reads.push([table,'in',...args]);return q},neq:()=>q,limit:()=>q,maybeSingle:()=>{single=true;return q},then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({error:null,count:table==='opname_counts'?s.locked:0,data:table==='opname_orders'?(single?{id:'draft',no_opname:'OPO.I06',status:s.status,warehouse_id:'wh',warehouses:{name:'Fictional warehouse',branch_id:'branch'},tanggal_mulai:'2026-10-23',penanggung_jawab:'Counter',cancelled_at:s.status==='Batal'?'2026-10-23T01:00:00Z':null,cancelled_by:'actor',cancelled_by_name:'Fictional actor',cancel_reason:'Fictional abandoned plan'}:[]):table==='warehouses'?[{id:'wh',branch_id:'branch'}]:table==='profiles'?{full_name:'Fictional actor'}:[]}).then(resolve)};return q}})}));
import DetailPage from '@/app/(app)/pos/opname/[id]/page';
const render=async()=>renderToStaticMarkup(await DetailPage({params:Promise.resolve({id:'draft'}),searchParams:Promise.resolve({})}));
beforeEach(()=>{s.status='Terbuka';s.locked=0;s.allowed=null;s.reads=[]});
it('offers a reasoned cancellation for an empty draft and retains its exact route identity',async()=>{const html=await render();expect(html).toContain('Batalkan draf');expect(html).toContain('name="reason"');expect(html).toContain('name="order_id" value="draft"')});
it('explains partially locked orders without offering draft cancellation',async()=>{s.locked=1;const html=await render();expect(html).toContain('hitungan terkunci');expect(html).not.toContain('name="reason"')});
it('shows retained cancellation evidence without rendering count/posting results',async()=>{s.status='Batal';const html=await render();expect(html).toContain('Fictional abandoned plan');expect(html).toContain('Fictional actor');expect(html).not.toContain('POSTED RESULT');expect(html).not.toContain('Batalkan draf')});

it('restricts metadata queries to existing allowed branches and visible warehouses',async()=>{s.allowed=['branch'];await render();expect(s.reads).toContainEqual(['warehouses','in','branch_id',['branch']]);expect(s.reads).toContainEqual(['opname_orders','in','warehouse_id',['wh']])});
