import React from'react';import{beforeEach,it,expect,vi}from'vitest';
const state=vi.hoisted(()=>({userId:'user',allowed:true,failed:'',authReads:0,doctorReads:0,tables:{}as Record<string,Record<string,unknown>[]>}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>{state.authReads++;return{data:{user:{id:state.userId}}}}},rpc:async()=>({data:state.allowed,error:state.failed==='rpc'?{}:null}),from:(table:string)=>{const filters:((r:Record<string,unknown>)=>boolean)[]=[];const result=()=>({data:state.failed===table?null:(state.tables[table]??[]).filter(r=>filters.every(f=>f(r))),error:state.failed===table?{}:null});const q={select:()=>q,eq:(k:string,v:unknown)=>{filters.push(r=>r[k]===v);return q},or:()=>q,is:()=>q,order:()=>q,limit:()=>q,range:async()=>({...result(),count:result().data?.length??0}),maybeSingle:async()=>({...result(),data:result().data?.[0]??null}),then:(resolve:(x:unknown)=>void)=>Promise.resolve({...result(),count:result().data?.length??null}).then(resolve)};return q}})}));
vi.mock('@/lib/dokter',()=>({daftarDokter:async()=>{state.doctorReads++;return[{id:'doctor',nama:'Dr. Fiction',jabatan:'Dokter Hewan'},{id:'groomer',nama:'Groomer Fiction',jabatan:'Groomer'}]}}));vi.mock('@/lib/service-performers-server',()=>({loadServiceStaff:async()=>[],loadBranchGroomingPolicy:async()=>null}));vi.mock('@/lib/rombongan-server',()=>({bacaSaudaraKunjungan:async()=>[]}));vi.mock('@/lib/katalog-racikan-server',()=>({bolehRacikKhusus:async()=>false,loadKatalogRacikan:async()=>[]}));
vi.mock('@/app/(app)/klinik/rekam-medis/[visitId]/RekamForm',()=>({RekamForm:()=>null}));vi.mock('@/app/(app)/klinik/rekam-medis/[visitId]/RacikanInline',()=>({RacikanInline:()=>null}));vi.mock('@/app/(app)/klinik/rawat-inap/actions',()=>({admitInpatient:vi.fn()}));
import Page from'@/app/(app)/klinik/rekam-medis/[visitId]/page';
function elements(node:React.ReactNode):React.ReactElement<Record<string,unknown>>[]{if(!React.isValidElement<Record<string,unknown>>(node))return[];return[node,...React.Children.toArray(node.props.children as React.ReactNode).flatMap(elements)]}
beforeEach(()=>{state.allowed=true;state.failed='';state.tables={visits:[{id:'visit',pet_id:'pet',branch_id:'branch',poli:'Poli Umum',status:'Pembayaran',created_at:'2026-10-24T00:00:00Z',service_started_at:'2026-10-24T01:00:00Z',service_finished_at:'2026-10-24T02:00:00Z',checked_out_at:null,pets:{name:'Milo'},customers:{name:'Pemilik'}}],medical_records:[{id:'record',visit_id:'visit',clinical_revision:2,submission_key:'initial',anamnesis:'Saved',diagnosis:'Existing',therapy:'Therapy',suhu:0,berat:3,gejala_klinis:null,hasil_penunjang:null,penunjang_urls:[],follow_up:'Kontrol',catatan_resep:null}],prescription_items:[{medical_record_id:'record',nama_obat:'Saved medicine',qty:2,aturan_pakai:'2x'}],compounding_recipes:[{id:'recipe',medical_record_id:'record',recipe_name:'Saved compound',status:'ready'}]}});
const page=async(edit?:string)=>elements(await Page({params:Promise.resolve({visitId:'visit'}),searchParams:Promise.resolve(edit?{edit}:{})}));
beforeEach(()=>{state.userId='user';state.authReads=0;state.doctorReads=0});
it.each(['OWNER','DOCTOR'])('%s positive DB eligibility reaches Edit button and original full form',async(role)=>{
 state.userId=role.toLowerCase();state.allowed=true;
 expect((await page()).some(x=>x.props.href==='/klinik/rekam-medis/visit?edit=record')).toBe(true);
 const form=(await page('record')).find(x=>x.props.correction)!;
 expect(form.props.draftUserId).toBe(role.toLowerCase());
 expect(form.props.correction).toMatchObject({fullEdit:true,recordId:'record',revision:2});
});
it.each(['STAFF','ADMIN','FINANCE','disabled OWNER'])('%s negative DB eligibility hides Edit and rejects direct edit URL',async(role)=>{
 state.userId=role;state.allowed=false;
 expect((await page()).some(x=>x.props.href==='/klinik/rekam-medis/visit?edit=record')).toBe(false);
 expect((await page('record')).some(x=>x.props.correction)).toBe(false);
});
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
it('loads full master catalog and source IDs when a doctor opens Edit',async()=>{state.tables.prescription_items[0].id='rx';state.tables.prescription_items[0].item_id='sku';const nodes=await page('record');const form=nodes.find(x=>'correction'in x.props)!;expect(form.props.correction).toMatchObject({fullEdit:true,prescriptions:[{id:'rx',item_id:'sku'}]});expect(state.doctorReads).toBe(1)});
it('rejects an unauthorized or stale record query without opening another form',async()=>{state.allowed=false;expect((await page('record')).some(x=>x.props.correction)).toBe(false);state.allowed=true;expect((await page('foreign-record')).some(x=>x.props.correction)).toBe(false)});
it('keeps an issued or unreadable invoice read-only even with a stale positive eligibility response',async()=>{
 state.tables.invoices=[{id:'invoice',visit_id:'visit'}];
 expect((await page('record')).some(x=>x.props.correction)).toBe(false);
 expect((await page()).some(x=>x.props.href==='/klinik/rekam-medis/visit?edit=record')).toBe(false);
 state.tables.invoices=[];state.failed='invoices';
 expect((await page('record')).some(x=>x.props.correction)).toBe(false);
});
it('keeps a paid visit read-only even if readiness response is unexpectedly true',async()=>{state.tables.visits[0].status='Selesai';state.tables.visits[0].checked_out_at='2026-10-24T03:00:00Z';expect((await page('record')).some(x=>x.props.correction)).toBe(false)});
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
it('K01: once an invoice is posted, offers an addendum form and lists saved addenda with author',async()=>{
 expect((await page()).some(x=>String(x.props.scope??'').startsWith('clinical-addendum:'))).toBe(false);
 state.tables.invoices=[{id:'invoice',visit_id:'visit',voided_at:null}];
 state.tables.clinic_record_addenda=[{id:'ad',medical_record_id:'record',diagnosis_addendum:'Tambahan diagnosa',therapy_addendum:null,reason:null,created_at:'2026-10-25T00:00:00Z',created_by:'user',profiles:{full_name:'Dokter Fiksi'}}];
 const nodes=await page();
 expect(nodes.some(x=>x.props.scope==='clinical-addendum:visit:record')).toBe(true);
 expect(nodes.some(x=>React.Children.toArray(x.props.children as React.ReactNode).includes('Dokter Fiksi'))).toBe(true);
});
