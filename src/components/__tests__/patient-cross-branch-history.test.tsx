import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const s=vi.hoisted(()=>({rpc:null as null|{data:unknown;error:unknown},rpcArgs:[] as unknown[],allowed:['A','B'] as string[],active:true,visibleAnchor:true,sessionMismatch:false,stalePet:false,anchorReads:0,spill:'',longHistory:false,broken:'',calls:[] as {scope:string;table:string;select:string;eq:Record<string,unknown>;in:Record<string,unknown>;from?:number}[],factories:[] as Record<string,unknown>[],keys:[] as string[]}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('NOT_FOUND')}}));
vi.mock('next/headers',()=>({cookies:async()=>({getAll:()=>[{name:'session',value:'fictional-session'}],set:vi.fn()}),headers:async()=>new Headers({'x-kamo-operational-branch':'B'})}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>client('operational')}));
vi.mock('@supabase/ssr',()=>({createServerClient:(_url:string,key:string,options:Record<string,unknown>)=>{s.keys.push(key);s.factories.push(options);return client('history');}}));
import Page from '@/app/(app)/klinik/antrian/[id]/page';
const pet={id:'pet',name:'Fictional pet',species:'Kucing',created_at:'2026-01-01T00:00:00Z'};
const customer={id:'customer',name:'Fictional owner',points:0};
const visits=[
 {id:'old-A',pet_id:'pet',branch_id:'A',created_at:'2026-10-23T01:00:00Z',poli:'Poli Umum',dokter:'Fictional vet A',keluhan:'Clinical A',pets:pet,customers:customer,branches:{name:'Branch A'},medical_records:[]},
 {id:'anchor-B',pet_id:'pet',branch_id:'B',created_at:'2026-10-24T01:00:00Z',poli:'Poli Umum',dokter:'Fictional vet B',keluhan:'Clinical B',pets:pet,customers:customer,branches:{name:'Branch B'},medical_records:[]},
 {id:'unrelated',pet_id:'other-pet',branch_id:'A',created_at:'2026-10-23T02:00:00Z',poli:'Poli Umum',keluhan:'UNRELATED PRIVATE',branches:{name:'Branch A'}},
];
const records=[{id:'record-A',visit_id:'old-A',created_at:'2026-10-23T01:10:00Z',diagnosis:'Historical finding A',anamnesis:'Historical assessment A',therapy:'Historical therapy A'}];
const prescriptions=[{id:'rx-A',medical_record_id:'record-A',nama_obat:'Fictional prior medicine',qty:2,satuan:'tablet',jenis:'obat',aturan_pakai:'Historical instructions'}];
function client(scope:string){
 return {rpc:async(name:string,args:unknown)=>{s.rpcArgs.push({name,args});return s.rpc??{data:null,error:{code:'PGRST202',message:'not installed'}}},auth:{getUser:async()=>({data:{user:{id:scope==='history'&&s.sessionMismatch?'other-account':'actor'}},error:null})},from(table:string){
  const request={scope,table,select:'',eq:{},in:{}} as typeof s.calls[number];s.calls.push(request);let single=false;let from=0,to=999;
  const q={select(fields:string){request.select=fields;return q},eq(k:string,v:unknown){request.eq[k]=v;return q},in(k:string,v:unknown[]){request.in[k]=v;return q},is(){return q},order(){return q},range(a:number,b:number){from=a;to=b;request.from=a;return q},limit(n:number){to=n-1;return q},maybeSingle(){single=true;return q},then(done:(r:unknown)=>unknown){
   const visible=(v:typeof visits[number])=>s.allowed.includes(v.branch_id)&&(scope==='history'||v.branch_id==='B')&&(s.visibleAnchor||v.id!=='anchor-B');
   let rows:Record<string,unknown>[]=[];
   if(table==='profiles')rows=[{id:'actor',role:'OWNER',is_active:s.active}];
   if(table==='visits')rows=visits.filter(visible);
   if(table==='visits'&&scope==='history'&&s.longHistory)rows.push(...Array.from({length:605},(_,i)=>({...visits[0],id:'tail-'+i,keluhan:'Clinical tail '+i})));
   if(table==='medical_records')rows=records.filter(m=>visits.some(v=>v.id===m.visit_id&&visible(v)));
   if(table==='prescription_items')rows=prescriptions.filter(r=>records.some(m=>m.id===r.medical_record_id&&visits.some(v=>v.id===m.visit_id&&visible(v))));
   rows=rows.filter(row=>Object.entries(request.eq).every(([key,value])=>row[key]===value)&&Object.entries(request.in).every(([key,values])=>(values as unknown[]).includes(row[key])));
   if(table==='visits'&&single&&scope==='operational'){s.anchorReads++;if(s.stalePet&&s.anchorReads>1)rows=rows.map(row=>({...row,pet_id:'different-pet'}));}
   if(scope==='history'&&s.spill===table)rows.push(table==='visits'?visits[2]:{...records[0],id:'wrong-parent',visit_id:'unrelated'});
   const error=scope==='history'&&s.broken===table?{message:'PRIVATE backend failure'}:null;
   return Promise.resolve({data:error?null:single?rows[0]??null:rows.slice(from,to+1),count:error?null:rows.length,error}).then(done);
  }};return q;
 }};
}
beforeEach(()=>{s.rpc=null;s.rpcArgs=[];s.allowed=['A','B'];s.active=true;s.visibleAnchor=true;s.sessionMismatch=false;s.stalePet=false;s.anchorReads=0;s.spill='';s.longHistory=false;s.broken='';s.calls=[];s.factories=[];s.keys=[];vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','http://127.0.0.1:54399');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','fictional-public-key');});
afterEach(()=>vi.unstubAllEnvs());
const render=async()=>renderToStaticMarkup(await Page({params:Promise.resolve({id:'anchor-B'})}));
it('shows the same pet clinical history from both already-authorized branches despite current branch B',async()=>{
 const html=await render();expect(html).toContain('Historical finding A');expect(html).toContain('Historical therapy A');expect(html).toContain('Fictional prior medicine');expect(html).toContain('Branch A');
 expect(s.factories).toHaveLength(1);
 expect(s.keys).toEqual(['fictional-public-key']);
 const options=s.factories[0] as {global?:{headers?:Record<string,string>};cookies:{getAll:()=>unknown}};
 expect(options.global?.headers?.['x-kamo-operational-branch']).toBeUndefined();expect(options.cookies.getAll()).toEqual([{name:'session',value:'fictional-session'}]);
 expect(s.calls.filter(c=>c.scope==='history'&&c.table==='visits').every(c=>c.eq.pet_id==='pet')).toBe(true);
});
it('rejects a changed pet anchor before constructing the history session',async()=>{
 s.stalePet=true;const html=await render();expect(html).toContain('Riwayat klinis belum dapat dimuat lengkap');expect(html).not.toContain('Historical finding A');expect(s.factories).toHaveLength(0);
});
it.each(['visits','medical_records'])('rejects unexpected patient/parent rows in %s without partial disclosure',async table=>{
 s.spill=table;const html=await render();expect(html).toContain('Riwayat klinis belum dapat dimuat lengkap');expect(html).not.toContain('UNRELATED PRIVATE');expect(html).not.toContain('Historical finding A');
});
it('loads clinical history beyond the first 500 rows with bounded child lookups',async()=>{
 s.longHistory=true;const html=await render();expect(html).toContain('Clinical tail 604');expect(s.calls.some(c=>c.scope==='history'&&c.table==='visits'&&c.from===500)).toBe(true);
 expect(s.calls.filter(c=>c.scope==='history'&&c.table==='medical_records').every(c=>(c.in.visit_id as unknown[]).length<=200)).toBe(true);
});
it('never grants a single-branch account access to another branch history',async()=>{
 s.allowed=['B'];const html=await render();expect(html).toContain('Clinical B');expect(html).not.toContain('Historical finding A');expect(html).not.toContain('Fictional prior medicine');
});
it('does not read history when the anchor visit is inaccessible',async()=>{
 s.visibleAnchor=false;await expect(render()).rejects.toThrow('NOT_FOUND');expect(s.factories).toHaveLength(0);
});
it('keeps unrelated patients and foreign operational/payment links out of clinical history',async()=>{
 const html=await render();expect(html).not.toContain('UNRELATED PRIVATE');expect(html).not.toContain('href="/klinik/rekam-medis/old-A"');expect(html).not.toContain('href="/klinik/pembayaran/old-A"');
 expect(html).toContain('baca saja');expect(html).toContain('Historical finding A');
 expect(s.calls.filter(c=>c.scope==='history').every(c=>['visits','medical_records','prescription_items'].includes(c.table))).toBe(true);
 expect(s.calls.filter(c=>['sales','invoices','inpatient_records','compounding_recipes'].includes(c.table)).every(c=>c.scope==='operational')).toBe(true);
});
it.each(['inactive','session mismatch','child read error'])('fails closed with an honest unavailable message for %s',async reason=>{
 if(reason==='inactive')s.active=false;if(reason==='session mismatch')s.sessionMismatch=true;if(reason==='child read error')s.broken='medical_records';
 const html=await render();expect(html).toContain('Riwayat klinis belum dapat dimuat lengkap');expect(html).not.toContain('Historical finding A');expect(html).not.toContain('PRIVATE backend failure');
});

const rpcVisit=(over:Record<string,unknown>={})=>({id:'anchor-B',pet_id:'pet',branch_id:'B',branch_name:'Branch B',created_at:'2026-10-24T01:00:00Z',poli:'Poli Umum',dokter:'Fictional vet B',keluhan:'Clinical B',can_open:true,records:[],...over});
it('K13: single-branch doctor sees branch A history through the checked reader, labelled and read-only',async()=>{
 s.allowed=['B'];
 s.rpc={data:{pet_id:'pet',visits:[rpcVisit(),rpcVisit({id:'old-A',branch_id:'A',branch_name:'Branch A',can_open:false,keluhan:'Clinical A',
  records:[{id:'record-A',created_at:'2026-10-23T01:10:00Z',diagnosis:'Historical finding A',anamnesis:'x',therapy:'Historical therapy A',
   prescriptions:[{id:'rx-A',nama_obat:'Fictional prior medicine',qty:2,satuan:'tablet',jenis:'obat',aturan_pakai:null}],
   addenda:[{id:'ad-1',created_at:'2026-10-25T01:00:00Z',author:'Fictional vet A',diagnosis:'Addendum finding',therapy:null,reason:null}]}]})]},error:null};
 const html=await render();
 expect(s.rpcArgs).toEqual([{name:'clinic_patient_clinical_history',args:{p_pet_id:'pet',p_anchor_visit_id:'anchor-B'}}]);
 expect(html).toContain('Historical finding A');expect(html).toContain('Branch A');expect(html).toContain('Addendum finding');
 expect(html).not.toContain('href="/klinik/rekam-medis/old-A"');
 expect(s.factories).toHaveLength(0);
});
it('K13: rejects a reader payload that mixes another patient (same name or not)',async()=>{
 s.rpc={data:{pet_id:'pet',visits:[rpcVisit(),rpcVisit({id:'unrelated',pet_id:'other-pet',keluhan:'UNRELATED PRIVATE'})]},error:null};
 const html=await render();expect(html).toContain('Riwayat klinis belum dapat dimuat lengkap');expect(html).not.toContain('UNRELATED PRIVATE');
});
it('K13: a denied reader fails closed instead of falling back',async()=>{
 s.rpc={data:null,error:{code:'42501',message:'denied'}};
 const html=await render();expect(html).toContain('Riwayat klinis belum dapat dimuat lengkap');expect(s.factories).toHaveLength(0);
});
