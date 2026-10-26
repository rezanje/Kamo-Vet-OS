import React from'react';import{beforeEach,it,expect,vi}from'vitest';
const state=vi.hoisted(()=>({allowed:true,failed:'',authReads:0,doctorReads:0,tables:{}as Record<string,Record<string,unknown>[]>}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>{state.authReads++;return{data:{user:{id:'user'}}}}},rpc:async()=>({data:state.allowed,error:state.failed==='rpc'?{}:null}),from:(table:string)=>{const filters:((r:Record<string,unknown>)=>boolean)[]=[];const result=()=>({data:state.failed===table?null:(state.tables[table]??[]).filter(r=>filters.every(f=>f(r))),error:state.failed===table?{}:null});const q={select:()=>q,eq:(k:string,v:unknown)=>{filters.push(r=>r[k]===v);return q},not:(k:string,_op:string,v:unknown)=>{filters.push(r=>r[k]!==v);return q},is:(k:string,v:unknown)=>{filters.push(r=>(r[k]??null)===v);return q},or:()=>q,order:()=>q,limit:()=>q,range:async()=>({...result(),count:result().data?.length??0}),maybeSingle:async()=>({...result(),data:result().data?.[0]??null}),then:(resolve:(x:unknown)=>void)=>Promise.resolve(result()).then(resolve)};return q}})}));
vi.mock('@/lib/dokter',()=>({daftarDokter:async()=>{state.doctorReads++;return[{id:'doctor',nama:'Dr. Fiction',jabatan:'Dokter Hewan'},{id:'groomer',nama:'Groomer Fiction',jabatan:'Groomer'}]}}));vi.mock('@/lib/service-performers-server',()=>({loadServiceStaff:async()=>[],loadBranchGroomingPolicy:async()=>null}));vi.mock('@/lib/rombongan-server',()=>({bacaSaudaraKunjungan:async()=>[]}));vi.mock('@/lib/katalog-racikan-server',()=>({bolehRacikKhusus:async()=>false,loadKatalogRacikan:async()=>[]}));
vi.mock('@/app/(app)/klinik/rekam-medis/[visitId]/RekamForm',()=>({RekamForm:()=>null}));vi.mock('@/app/(app)/klinik/rekam-medis/[visitId]/RacikanInline',()=>({RacikanInline:()=>null}));vi.mock('@/app/(app)/klinik/rawat-inap/actions',()=>({admitInpatient:vi.fn()}));
import Page from'@/app/(app)/klinik/rekam-medis/[visitId]/page';
function elements(node:React.ReactNode):React.ReactElement<Record<string,unknown>>[]{if(!React.isValidElement<Record<string,unknown>>(node))return[];return[node,...React.Children.toArray(node.props.children as React.ReactNode).flatMap(elements)]}
beforeEach(()=>{state.allowed=true;state.failed='';state.tables={visits:[{id:'visit',pet_id:'pet',branch_id:'branch',poli:'Poli Umum',status:'Pembayaran',created_at:'2026-10-24T00:00:00Z',service_started_at:'2026-10-24T01:00:00Z',service_finished_at:'2026-10-24T02:00:00Z',checked_out_at:null,pets:{name:'Milo'},customers:{name:'Pemilik'}}],medical_records:[{id:'record',visit_id:'visit',clinical_revision:2,submission_key:'initial',anamnesis:'Saved',diagnosis:'Existing',therapy:'Therapy',suhu:0,berat:3,gejala_klinis:null,hasil_penunjang:null,penunjang_urls:[],follow_up:'Kontrol',catatan_resep:null}],prescription_items:[{medical_record_id:'record',nama_obat:'Saved medicine',qty:2,aturan_pakai:'2x'}],compounding_recipes:[{id:'recipe',medical_record_id:'record',recipe_name:'Saved compound',status:'ready'}]}});
const page=async(edit?:string)=>elements(await Page({params:Promise.resolve({visitId:'visit'}),searchParams:Promise.resolve(edit?{edit}:{})}));
beforeEach(()=>{state.authReads=0;state.doctorReads=0});
it('reads the current session once when rendering the saved clinical record',async()=>{
 const nodes=await page();
 expect(nodes.some(x=>x.props.href==='/klinik/rekam-medis/visit?edit=record')).toBe(true);
 expect(state.authReads).toBe(1);
});
it('loads one staff roster for both doctor and provider choices before initial save',async()=>{
 state.tables.visits[0].status='Diperiksa';
 const nodes=await page();
 const form=nodes.find(x=>'dokterOpsi'in x.props)!;
 expect(form.props.dokterOpsi).toMatchObject([{id:'doctor'},{id:'groomer'}]);
 expect(form.props.providerOpsi).toMatchObject([{id:'doctor'}]);
 expect(state.doctorReads).toBe(1);
});
it('places Edit in result linking to the same visit and exact record',async()=>{const nodes=await page();expect(nodes.some(x=>x.props.href==='/klinik/rekam-medis/visit?edit=record')).toBe(true);expect(nodes.some(x=>'correction'in x.props)).toBe(false)});
it('opens the original form with exact persisted source and downstream snapshots',async()=>{const nodes=await page('record');const form=nodes.find(x=>'correction'in x.props)!;expect(form?.props.visitId).toBe('visit');expect(form?.props.correction).toMatchObject({recordId:'record',revision:2,anamnesis:'Saved',suhu:0,berat:3,prescriptions:[expect.objectContaining({nama_obat:'Saved medicine'})]})});
it.each(['rpc','medical_records','prescription_items','compounding_recipes'])('fails closed when %s cannot be checked',async table=>{state.failed=table;expect((await page('record')).some(x=>x.props.correction)).toBe(false)});
it('rejects an unauthorized or stale record query without opening another form',async()=>{state.allowed=false;expect((await page('record')).some(x=>x.props.correction)).toBe(false);state.allowed=true;expect((await page('foreign-record')).some(x=>x.props.correction)).toBe(false)});
it('keeps a paid visit read-only even if readiness response is unexpectedly true',async()=>{state.tables.visits[0].status='Selesai';state.tables.visits[0].checked_out_at='2026-10-24T03:00:00Z';expect((await page('record')).some(x=>x.props.correction)).toBe(false)});
it('offers a separate addendum for a paid record without reopening its source form',async()=>{
 state.tables.visits[0].status='Selesai';
 state.tables.invoices=[{id:'paid',visit_id:'visit',paid_status:'Lunas',paid_at:'2026-10-24T03:00:00Z',voided_at:null}];
 const nodes=await page('record');
 expect(nodes.some(x=>x.props.correction)).toBe(false);
 expect(nodes.some(x=>x.props.scope==='paid-clinical-addendum:visit:record')).toBe(true);
 state.failed='clinic_paid_record_addenda';
 expect((await page()).some(x=>x.props.scope==='paid-clinical-addendum:visit:record')).toBe(false);
});
it('retains paid addendum history after the invoice is voided without offering another write',async()=>{
 state.tables.visits[0].status='Selesai';
 state.tables.invoices=[{id:'paid',visit_id:'visit',paid_status:'Lunas',paid_at:'2026-10-24T03:00:00Z',voided_at:'2026-10-24T04:00:00Z'}];
 state.tables.clinic_paid_record_addenda=[{id:'addendum',medical_record_id:'record',reason:'Alasan',amendment:'Catatan',created_by:'user',created_at:'2026-10-24T03:30:00Z'}];
 const nodes=await page();
 expect(nodes.some(x=>x.props.scope==='paid-clinical-addendum:visit:record')).toBe(false);
 expect(nodes.some(x=>Array.isArray(x.props.children) && x.props.children[0]==='Catatan tambahan: ' && x.props.children[1]==='Catatan')).toBe(true);
});
it('offers late racikan only while the same saved record is eligible and unpaid',async()=>{
  expect((await page()).some(x=>x.props.medicalRecordId==='record')).toBe(true);
  // Clinical-note correction needs a submission key; legacy unpaid racikan
  // still works when there is no invoice.
  state.allowed=false;
  expect((await page()).some(x=>x.props.medicalRecordId==='record')).toBe(true);
  state.allowed=true;
  state.tables.invoices=[{id:'invoice',visit_id:'visit'}];
  expect((await page()).some(x=>x.props.medicalRecordId==='record')).toBe(false);
  state.tables.invoices=[];
  state.failed='invoices';
  expect((await page()).some(x=>x.props.medicalRecordId==='record')).toBe(false);
  state.failed='';
  state.tables.visits[0].status='Selesai';
  expect((await page()).some(x=>x.props.medicalRecordId==='record')).toBe(false);
});
