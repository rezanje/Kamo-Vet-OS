import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { handoffSourceStatus, type InpatientHandoff } from '@/lib/inpatient-handoff';
const s=vi.hoisted(()=>({branch:'branch-a',allowed:['branch-a'] as string[]|null,user:true,longRx:false,duplicateInvoice:false,forcedConsent:false,paidStay:'' as ''|'Lunas'|'DP',secondStay:false,broken:'',authReads:0,reads:[] as {table:string;eq:Record<string,unknown>;in:Record<string,unknown>;from?:number}[]}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('NOT_FOUND')}}));
vi.mock('@/lib/branch-access',()=>({allowedBranchIds:async()=>s.allowed,canUseBranch:(allowed:string[]|null,id:string)=>allowed===null||allowed.includes(id)}));
vi.mock('@/app/(app)/klinik/rawat-inap/[id]/PapanPemantauan',()=>({PapanPemantauan:()=> <div>DAILY MONITORING</div>}));
vi.mock('@/app/(app)/klinik/rawat-inap/[id]/ObatKhusus',()=>({ObatKhusus:()=> <div>DOSE PROTOCOL</div>}));
vi.mock('@/app/(app)/klinik/rawat-inap/actions',()=>({changeCondition:async()=>{},sendRipWa:async()=>{}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>{s.authReads++;return{data:{user:s.user?{id:'actor'}:null}}}},from(table:string){
 const request={table,eq:{},in:{}} as {table:string;eq:Record<string,unknown>;in:Record<string,unknown>;from?:number;to?:number};s.reads.push(request);let single=false;
 const q={select:()=>q,eq:(k:string,v:unknown)=>{request.eq[k]=v;return q},in:(k:string,v:unknown)=>{request.in[k]=v;return q},order:()=>q,limit:()=>q,is:()=>q,range:(from:number,to:number)=>{request.from=from;request.to=to;return q},maybeSingle:()=>{single=true;return q},then:(done:(v:unknown)=>unknown)=>{
  let data:unknown=[];
  if(table==='inpatient_records')data={id:'inpat',branch_id:s.branch,visit_id:'visit-a',admitted_at:'2026-10-22T10:00:00Z',condition_status:'stabil',discharged_at:null,treatment_plan:'Fictional care',doctor_name:'Drh Inap',branches:{name:'Branch A'},visits:{id:'visit-a',poli:'Umum',keluhan:'Fictional complaint',created_at:'2026-10-22T08:00:00Z',pets:{name:'Fictional pet'},customers:{name:'Fictional owner'}}};
  if(table==='inpatient_records'&&request.eq.visit_id)data=s.secondStay?[{id:'inpat'},{id:'inpat-old'}]:[{id:'inpat'}];
  if(table==='profiles')data={role:'DOCTOR'};
  if(table==='consents'&&s.forcedConsent)data=[{status:'sudah_ttd',kategori:'Pulang Paksa',signed_at:'2026-10-22T12:00:00Z'}];
  if(table==='visits')data={id:'visit-a',branch_id:s.branch,dokter:'Drh Konsultasi',keluhan:'Fictional complaint',created_at:'2026-10-22T08:00:00Z',status:'Pembayaran'};
  if(table==='medical_records')data=[{id:'mr-a',visit_id:'visit-a',created_at:'2026-10-22T09:00:00Z',anamnesis:'Fictional consultation note',diagnosis:'Fictional finding',catatan_resep:'Global prescription note'}];
  if(table==='prescription_items')data=[{id:'rx-a',medical_record_id:'mr-a',nama_obat:'Fictional tablet',qty:2,satuan:'tablet',jenis:'obat',aturan_pakai:'Fictional instructions',compound_recipe_id:null,created_at:'2026-10-22T09:00:00Z'},{id:'rx-later',medical_record_id:'mr-a',nama_obat:'Later fictional procedure',qty:1,satuan:'kali',jenis:'jasa',aturan_pakai:null,compound_recipe_id:null,created_at:'2026-10-22T11:00:00Z'}];
  if(table==='compounding_recipes')data=[{id:'recipe-a',medical_record_id:'mr-a',recipe_name:'Fictional mixture',total_volume:'30 ml',dosage_form:'sirup',dosage_instruction:'Fictional mixture instructions',status:'handed_over',created_at:'2026-10-22T09:10:00Z'}];
  if(table==='invoices')data=[{id:'invoice-paid',visit_id:'visit-a',invoice_no:'INV.PAID',paid_status:'Lunas',voided_at:null,created_at:'2026-10-22T09:30:00Z'},{id:'invoice-void',visit_id:'visit-a',invoice_no:'INV.OLD',paid_status:'Lunas',voided_at:'2026-10-22T10:00:00Z',created_at:'2026-10-22T09:00:00Z'}];
  if(table==='invoice_items')data=[{id:'line-paid',invoice_id:'invoice-paid',prescription_item_id:'rx-a',compound_recipe_id:null,qty:1},{id:'line-void',invoice_id:'invoice-void',prescription_item_id:null,compound_recipe_id:'recipe-a',qty:1}];
  if(s.duplicateInvoice&&table==='invoices')data=[{id:'invoice-paid',visit_id:'visit-a',invoice_no:'INV.PAID',paid_status:'Lunas',voided_at:null,created_at:'2026-10-22T09:30:00Z'},{id:'invoice-dp',visit_id:'visit-a',invoice_no:'INV.DP',paid_status:'DP',voided_at:null,created_at:'2026-10-22T11:30:00Z'}];
  if(s.duplicateInvoice&&table==='invoice_items')data=[{id:'line-paid',invoice_id:'invoice-paid',prescription_item_id:'rx-a',compound_recipe_id:null,qty:1},{id:'line-dp',invoice_id:'invoice-dp',prescription_item_id:'rx-a',compound_recipe_id:null,qty:1}];
  if(s.paidStay&&table==='prescription_items')data=[...(data as unknown[]),{id:'service-stay',medical_record_id:'mr-a',kategori:'Rawat Inap',nama_obat:'Fictional inpatient stay',qty:3,satuan:'hari',jenis:'jasa',aturan_pakai:'Otomatis dari lama rawat inap: 3 hari',compound_recipe_id:null,created_at:'2026-10-22T12:00:00Z'}];
  if(s.paidStay&&table==='invoices')data=[{id:'invoice-stay',visit_id:'visit-a',invoice_no:'INV.STAY',paid_status:s.paidStay,voided_at:null,created_at:'2026-10-22T13:00:00Z'}];
  if(s.paidStay&&table==='invoice_items')data=[{id:'line-stay',invoice_id:'invoice-stay',prescription_item_id:'service-stay',compound_recipe_id:null,qty:3}];
  if(table==='prescription_items'&&s.longRx)data=Array.from({length:1205},(_,i)=>({id:'rx-'+i,medical_record_id:'mr-a',nama_obat:'Fictional long '+i,qty:1,satuan:'tablet',jenis:'obat',aturan_pakai:null,compound_recipe_id:null,created_at:'2026-10-22T09:00:00Z'}));
  const rows=Array.isArray(data)?data:[];return Promise.resolve({data:single?(Array.isArray(data)?data[0]??null:data):Array.isArray(data)?data.slice(request.from??0,request.to===undefined?undefined:request.to+1):data,count:rows.length,error:table===s.broken?{message:'private read failure'}:null}).then(done);
 }};return q;}})}));
import Page from '@/app/(app)/klinik/rawat-inap/[id]/page';
const render=async()=>renderToStaticMarkup(await Page({params:Promise.resolve({id:'inpat'}),searchParams:Promise.resolve({})}));
beforeEach(()=>{s.branch='branch-a';s.allowed=['branch-a'];s.user=true;s.longRx=false;s.duplicateInvoice=false;s.forcedConsent=false;s.paidStay='';s.secondStay=false;s.broken='';s.authReads=0;s.reads=[]});
it('shows consultation, prescriptions and compound status before daily visit notes with explicit source links',async()=>{
 const html=await render();expect(html).toContain('Ringkasan konsultasi dan resep');expect(html).toContain('Keluhan awal kunjungan');expect(html).toContain('Fictional complaint');expect(html).toContain('Fictional consultation note');expect(html).toContain('Fictional tablet');expect(html).toContain('Fictional mixture instructions');expect(html).toContain('Drh Konsultasi');
 expect(html.indexOf('Ringkasan konsultasi dan resep')).toBeLessThan(html.indexOf('DAILY MONITORING'));expect(html).toContain('/klinik/rekam-medis/visit-a');expect(html).toContain('/klinik/racik/recipe-a');
});
it('keeps paid invoice, void history and unlinked additions distinct without claiming administration or paid duration',async()=>{
 const html=await render();expect(html).toContain('INV.PAID');expect(html).toContain('Lunas');expect(html).toContain('INV.OLD');expect(html).toContain('Dibatalkan');expect(html).toContain('Belum ada tautan tagihan per baris');expect(html).toContain('Diserahkan oleh farmasi');expect(html).toContain('bukan bukti obat sudah diberikan');expect(html).toContain('Lama inap terbayar hanya dari baris jasa rawat inap pada faktur lunas');
 expect(html).toContain('sudah dibayar <b>0 hari</b>');expect(html).toContain('Biaya hari inap belum masuk faktur lunas');
});
it('shows paid vs remaining stay days only from the visit stay line on a fully paid invoice',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-26T09:00:00Z'));
 try{
  s.paidStay='Lunas';const paid=await render();
  expect(paid).toContain('Sudah menginap <b>4 hari</b> · sudah dibayar <b>3 hari</b> · sisa belum dibayar <b>1 hari</b> · INV.STAY');
  s.paidStay='DP';const deposit=await render();
  expect(deposit).toContain('sudah dibayar <b>0 hari</b> · sisa belum dibayar <b>4 hari</b>');expect(deposit).toContain('DP tidak dihitung sebagai hari tertentu');
  s.paidStay='Lunas';s.secondStay=true;const ambiguous=await render();
  expect(ambiguous).toContain('Hari yang sudah dibayar belum dapat dipastikan');expect(ambiguous).not.toContain('sudah dibayar <b>3 hari</b>');
 }finally{vi.useRealTimers();}
});
it('denies anonymous or cross-branch parents before loading additional clinical data',async()=>{
 s.allowed=['branch-b'];await expect(render()).rejects.toThrow('NOT_FOUND');expect(s.reads.some(r=>r.table==='medical_records')).toBe(false);
 s.allowed=['branch-a'];s.user=false;s.reads=[];await expect(render()).rejects.toThrow('NOT_FOUND');expect(s.reads.some(r=>r.table==='medical_records')).toBe(false);
});
it('shows an unavailable summary on child read errors instead of presenting empty or paid clinical history',async()=>{
 s.broken='prescription_items';const html=await render();expect(html).toContain('Ringkasan belum dapat dimuat lengkap');expect(html).not.toContain('INV.PAID');expect(html).not.toContain('private read failure');
});

it('does not invent an invoice-specific route that ignores the requested old document',async()=>{const html=await render();expect(html).not.toContain('?invoice=');expect(html).toContain('Buka pembayaran kunjungan')});
it('loads every prescription beyond1000 using only the same visit record and exact invoice IDs',async()=>{s.longRx=true;const html=await render();expect(html).toContain('Fictional long 1204');expect(s.reads.some(r=>r.table==='prescription_items'&&r.from===1000)).toBe(true);expect(s.reads.filter(r=>r.table==='prescription_items').every(r=>JSON.stringify(r.in.medical_record_id)===JSON.stringify(['mr-a']))).toBe(true);expect(s.reads.find(r=>r.table==='medical_records')!.eq.visit_id).toBe('visit-a');expect(s.reads.find(r=>r.table==='visits')!.eq.branch_id).toBe('branch-a')});
const CHILD_READS=['visits','consents','inpatient_daily_logs','inpatient_status_log','profiles','items'];
it('reads the signed-in user once and loads the role for that same user',async()=>{
 const html=await render();expect(s.authReads).toBe(1);expect(html).toContain('Ringkasan konsultasi dan resep');
 expect(html).not.toContain('(akun ini bukan dokter)');
 const profile=s.reads.filter(r=>r.table==='profiles');expect(profile).toHaveLength(1);expect(profile[0].eq.id).toBe('actor');
 expect(s.reads.find(r=>r.table==='consents')!.eq.visit_id).toBe('visit-a');
});
it('starts no consent, log, role or tariff read before the parent passes the branch guard',async()=>{
 s.allowed=['branch-b'];await expect(render()).rejects.toThrow('NOT_FOUND');expect(s.reads.map(r=>r.table)).toEqual(['inpatient_records']);expect(s.authReads).toBe(1);
 s.allowed=['branch-a'];s.user=false;s.reads=[];s.authReads=0;await expect(render()).rejects.toThrow('NOT_FOUND');expect(s.reads.some(r=>CHILD_READS.includes(r.table))).toBe(false);expect(s.authReads).toBe(1);
});
it('still renders the page when the handoff summary fails while the other reads succeed',async()=>{
 s.broken='medical_records';const html=await render();expect(html).toContain('Ringkasan belum dapat dimuat lengkap');expect(html).toContain('DAILY MONITORING');expect(s.authReads).toBe(1);
});

it('keeps source billing, invoice payment, pharmacy handover and administration distinct in the existing panel',async()=>{
 const html=await render();
 expect(html).toContain('Status sumber per baris');
 expect(html).toContain('Faktur lunas; pembayaran belum dialokasikan per baris');
 expect(html).toContain('Belum ada bukti pemberian per resep');
 expect(html).toContain('Hanya pada faktur dibatalkan');
 expect(html).toContain('Pemberian obat biasa hanya terbukti dari catatan pemberian per resep');
 expect(html).toContain('Belum ada bukti penyerahan atau pemberian untuk resep ini.');
 expect(html).toContain('name="recordId" value="inpat"');
 expect(html).toContain('Catat penyerahan');
 expect(html).toContain('Catat pemberian');
 expect(html.match(/data-inpatient-handoff/g)).toHaveLength(1);
});

it('warns when an exact prescription source is on two active invoices without claiming a second charge was prevented',()=>{
 const data:InpatientHandoff={doctor:null,complaint:null,records:[],recipes:[],prescriptions:[{id:'rx',medical_record_id:'mr',nama_obat:'Fictional',qty:1,satuan:'tab',jenis:'obat',aturan_pakai:null,compound_recipe_id:null,created_at:'2026-10-22'}],invoices:[{id:'i1',invoice_no:'A',paid_status:'Lunas',voided_at:null,created_at:'2026-10-22'},{id:'i2',invoice_no:'B',paid_status:'DP',voided_at:null,created_at:'2026-10-22'}],invoiceLines:[{id:'l1',invoice_id:'i1',prescription_item_id:'rx',compound_recipe_id:null,qty:1},{id:'l2',invoice_id:'i2',prescription_item_id:'rx',compound_recipe_id:null,qty:1}],evidence:[]};
 const [row]=handoffSourceStatus(data).rows;
 expect(row.duplicateActiveInvoices).toBe(true);
 expect(row.billing).toContain('A · qty faktur 1; B · qty faktur 1');
 expect(row.payment).toContain('Faktur DP: pembayaran belum dialokasikan per baris');
});
it('shows the duplicate active invoice warning inside the existing handoff panel',async()=>{
 s.duplicateInvoice=true;
 const html=await render();
 expect(html).toContain('INV.PAID · qty faktur 1; INV.DP · qty faktur 1');
 expect(html).toContain('Tertaut ke lebih dari satu faktur aktif. Periksa sebelum menagih ulang.');
 expect(html).toContain('Faktur DP: pembayaran belum dialokasikan per baris');
});
it('offers forced discharge with a separate signed form step and keeps cross-branch reads guarded',async()=>{
 const unsigned=await render();
 expect(unsigned).toContain('value="pulang_paksa"');
 expect(unsigned).toContain('buat dan tandatangani form khusus kategori Pulang Paksa');
 expect(unsigned).toContain('/klinik/rekam-medis/visit-a');
 s.forcedConsent=true;
 const signed=await render();
 expect(signed).not.toContain('buat dan tandatangani form khusus kategori Pulang Paksa');
 s.allowed=['branch-b'];s.reads=[];
 await expect(render()).rejects.toThrow('NOT_FOUND');
 expect(s.reads.some(r=>r.table==='consents')).toBe(false);
});
it('shows explicit gaps for a verified empty source without inferring paid inpatient days',()=>{
 const empty:InpatientHandoff={doctor:null,complaint:null,records:[],prescriptions:[],recipes:[],invoices:[],invoiceLines:[],evidence:[]};
 const status=handoffSourceStatus(empty);
 expect(status.rows).toEqual([]);
 expect(status.gaps).toContain('Hari inap terbayar hanya dihitung dari satu baris jasa rawat inap pada faktur lunas; DP/cicilan tidak dialokasikan per hari.');
 expect(status.gaps.some(gap=>gap.includes('baris resep/racikan belum punya tautan'))).toBe(false);
});
it('keeps a linked compound available in its recipe card without counting one missing bill twice',()=>{
 const linked:InpatientHandoff={doctor:null,complaint:null,records:[],prescriptions:[{id:'rx',medical_record_id:'mr',nama_obat:'Fictional compound',qty:1,satuan:'btl',jenis:'obat',aturan_pakai:null,compound_recipe_id:'recipe',created_at:'2026-10-22'}],recipes:[{id:'recipe',medical_record_id:'mr',recipe_name:'Fictional recipe',total_volume:'30 ml',dosage_form:'sirup',dosage_instruction:'Fictional instruction',status:'handed_over',created_at:'2026-10-22'}],invoices:[],invoiceLines:[],evidence:[]};
 const status=handoffSourceStatus(linked);
 expect(status.rows.map(row=>row.key)).toEqual(['rx:rx','recipe:recipe']);
 expect(status.rows[1].handover).toBe('Diserahkan oleh farmasi');
 expect(status.gaps.filter(gap=>gap.includes('baris resep/racikan belum punya tautan'))).toEqual(['1 baris resep/racikan belum punya tautan tagihan per baris dan tidak dipasangkan berdasarkan nama.']);
});
