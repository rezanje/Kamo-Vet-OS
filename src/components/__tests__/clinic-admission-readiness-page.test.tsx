import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const s=vi.hoisted(()=>({status:'Pembayaran',checkedOut:null as string|null,doctor:'doctor',broken:'',consentCategory:'Rawat Inap',signed:true,existing:false}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('NOT_FOUND')}}));
vi.mock('@/lib/rombongan-server',()=>({bacaSaudaraKunjungan:async()=>[]}));
vi.mock('@/app/(app)/klinik/rekam-medis/[visitId]/RacikanInline',()=>({RacikanInline:()=>null}));
vi.mock('@/app/(app)/klinik/rekam-medis/[visitId]/ReferralPanel',()=>({ReferralPanel:()=>null}));
vi.mock('@/app/(app)/klinik/rawat-inap/actions',()=>({admitInpatient:async()=>{}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'actor'}}})},from(table:string){let single=false;const q={select:()=>q,eq:()=>q,in:()=>q,is:()=>q,order:()=>q,limit:()=>q,range:()=>q,maybeSingle:()=>{single=true;return q},then:(done:(v:unknown)=>unknown)=>{
 let data:unknown=[];
 if(table==='visits')data={id:'visit-a',branch_id:'branch-a',status:s.status,doctor_id:s.doctor,dokter:'Drh Fictional',checked_out_at:s.checkedOut,created_at:'2026-10-23T01:00:00Z',pets:{name:'Fictional pet'},customers:{name:'Fictional owner'}};
 if(table==='medical_records')data={id:'mr-a',diagnosis:'Fictional diagnosis',anamnesis:'Fictional notes'};
 if(table==='consent_rules')data={wajib:true,template_id:'tpl-inpatient'};
 if(table==='consents')data=[{id:'consent',kategori:s.consentCategory,template_id:'tpl-inpatient',status:s.signed?'sudah_ttd':'belum_ttd'}];
 if(table==='inpatient_records')data=s.existing?{id:'inpat',condition_status:'stabil',discharged_at:null}:null;
 return Promise.resolve({data:s.broken===table?null:single&&Array.isArray(data)?data[0]??null:data,error:s.broken===table?{message:'PRIVATE read failure'}:null,count:Array.isArray(data)?data.length:0}).then(done);
 }};return q;}})}));
import Page from '@/app/(app)/klinik/rekam-medis/[visitId]/page';
const render=async()=>renderToStaticMarkup(await Page({params:Promise.resolve({visitId:'visit-a'}),searchParams:Promise.resolve({})}));
const admission=(html:string)=>html.match(/<button[^>]*>[^<]*(?:<[^>]*>[^<]*<\/[^>]*>[^<]*)*Masukkan Rawat Inap<\/button>/)?.[0]??html.slice(html.lastIndexOf('<button'),html.lastIndexOf('</button>')+9);
beforeEach(()=>{s.status='Pembayaran';s.checkedOut=null;s.doctor='doctor';s.broken='';s.consentCategory='Rawat Inap';s.signed=true;s.existing=false});
it('keeps a valid signed inpatient consent eligible and a generic signed document blocked',async()=>{expect(admission(await render())).not.toContain('disabled');s.consentCategory='Umum';expect(admission(await render())).toContain('disabled')});
it.each(['consents','consent_rules','consent_templates','medical_records','inpatient_records'])('explains %s read failure as unverified instead of asking for another signature',async(table)=>{s.broken=table;const html=await render();expect(html).toContain('Kesiapan rawat inap belum dapat diverifikasi');expect(admission(html)).toContain('disabled');expect(html).not.toContain('PRIVATE read failure')});
it.each(['status','checkout'])('mirrors existing server rejection of closed visit (%s) without creating a new eligibility policy',async(mode)=>{if(mode==='status')s.status='Selesai';else s.checkedOut='2026-10-23T02:00:00Z';const html=await render();expect(admission(html)).toContain('disabled');expect(html).toContain('Kunjungan sudah selesai atau check-out');});
it('explains missing doctor and provides a direct consent section link for missing consent',async()=>{s.doctor='';let html=await render();expect(admission(html)).toContain('disabled');expect(html).toContain('Selesaikan pemeriksaan dan pilih dokter');s.doctor='doctor';s.signed=false;html=await render();expect(html).toContain('href="#persetujuan-rawat-inap"');expect(html).toContain('id="persetujuan-rawat-inap"')});
it('retains the link to an existing admission and does not offer a duplicate form',async()=>{s.existing=true;const html=await render();expect(html).toContain('/klinik/rawat-inap/inpat');expect(html).not.toContain('Masukkan Rawat Inap')});

it.each(['consents','consent_templates'])('does not claim missing documents or offer creation from an incomplete %s read',async(table)=>{s.broken=table;const html=await render();expect(html).toContain('Data persetujuan belum dapat dimuat lengkap');expect(html).not.toContain('Belum ada form persetujuan');expect(html).not.toContain('Belum ada template aktif');});
