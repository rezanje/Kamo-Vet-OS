import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({tables:{} as Record<string,Record<string,unknown>[]>,failed:false}));
vi.stubGlobal('React',React);
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:"recurring-reader"}}})},from(table:string){
 let counted=false,bounds:[number,number]|undefined;
 const filters:{or?:string;source?:string;notSourceRefs:string[]}={notSourceRefs:[]};
 const query={select(_fields:string,options?:{count:string}){counted=options?.count==='exact';return query;},order(){return query;},eq(key:string,value:string){if(key==='source')filters.source=value;return query;},or(value:string){filters.or=value;return query;},not(key:string,operator:string,value:string){if(key==='source_ref'&&operator==='like')filters.notSourceRefs.push(value.replace(/%$/,''));return query;},returns(){return query;},range(from:number,to:number){bounds=[from,to];return query;},then(resolve:(value:unknown)=>unknown){
 const all=fixture.tables[table]??[];
 const filtered=all.filter(row=>(!filters.source||row.source===filters.source)&&(!filters.or||filters.or.split(',').some(term=>{
   const match=/^source_ref\.like\.(.*)$/.exec(term);return !!match&&String(row.source_ref??'').startsWith(match[1].replace(/%$/,''));
 }))&&!filters.notSourceRefs.some(prefix=>String(row.source_ref??'').startsWith(prefix)));
 return Promise.resolve({data:fixture.failed&&table==='journal_entries'?null:bounds?filtered.slice(bounds[0],bounds[1]+1):filtered.slice(0,1000),count:counted?filtered.length:null,error:fixture.failed&&table==='journal_entries'?{message:'private DB detail'}:null}).then(resolve);
 }};return query;
}})}));
vi.mock('@/app/(app)/keuangan/jurnal-berulang/actions',()=>({toggleRecurring:async()=>{},createRecurring:async()=>{}}));
vi.mock('@/app/(app)/keuangan/jurnal-berulang/RecurringForm',()=>({RecurringForm:()=>null}));
import Page from '@/app/(app)/keuangan/jurnal-berulang/page';
const target='f3000000-0000-4000-8000-000000000001',other='f3000000-0000-4000-8000-000000000002';
beforeEach(()=>{fixture.failed=false;fixture.tables={
 recurring_journals:[{id:target,nama:'Completed old schedule',day_of_month:1,branch_id:null,is_active:true,max_occurrences:1,last_posted:'1800-01',lines:[]},{id:other,nama:'Other schedule',day_of_month:1,branch_id:null,is_active:true,max_occurrences:null,last_posted:null,lines:[]}],
 recurring_journal_sources:[],
 journal_entries:[...Array.from({length:1000},(_,i)=>{const period=`${1900+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`;return {id:`history-${i}`,no_jurnal:`JRN-${i}`,tanggal:`${period}-01`,source:'recurring',source_ref:`${other}:${period}`,branch_id:null,journal_lines:[{debit:100,credit:0},{debit:0,credit:100}]};}),{id:'old-target',no_jurnal:'JRN-OLD',tanggal:'1800-01-01',source:'recurring',source_ref:`${target}:1800-01`,branch_id:null,journal_lines:[{debit:100,credit:0},{debit:0,credit:100}]}],coa_accounts:[],branches:[]};});
it('keeps exhausted schedule completed after more than 1000 history rows',async()=>{
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));
 expect(html.includes('1 / 1 kali')).toBe(true);
 expect(html.includes('Selesai')).toBe(true);
});

it('shows a safe load error instead of false progress when history cannot load',async()=>{
 fixture.failed=true;
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));
 expect(html.includes('role="alert"')).toBe(true);
 expect(html.includes('Coba muat ulang')).toBe(true);
 expect(html.includes('private DB detail')).toBe(false);
 expect(html.includes('0 / 1 kali')).toBe(false);
});

it('renders a source schedule from its scoped proof instead of the empty legacy template',async()=>{
 const source='f3000000-0000-4000-8000-000000000003';
 fixture.tables.recurring_journals=[{id:source,nama:'Jurnal dari sumber',day_of_month:25,branch_id:null,is_active:true,max_occurrences:12,last_posted:null,is_source_schedule:true,lines:[]}];
 fixture.tables.recurring_journal_sources=[{id:source,source_entry_id:'f3000000-0000-4000-8000-000000000004',branch_id:null,
  source_snapshot:{entry_id:'f3000000-0000-4000-8000-000000000004',no_jurnal:'JU-1042',lines:[{debit:100,credit:0},{debit:0,credit:100}]},
  config:{name:'Amortisasi sewa fiktif',first_period:'2026-11',last_period:'2027-10',day:25,count:12,mode:'manual'}}];
 fixture.tables.journal_entries=[{id:'fiction-posted-entry',no_jurnal:'JU-FIKTIF-POSTED',tanggal:'2026-11-25',source_ref:`${source}:2026-11`,branch_id:null,journal_lines:[{debit:100,credit:0},{debit:0,credit:100}]}];
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));
 expect(html.includes('Amortisasi sewa fiktif')).toBe(true);
 expect(html.includes('Rp 100')).toBe(true);
 expect(html.includes('0 / 12 periode')).toBe(true);
 expect(html.includes('Lihat periode')).toBe(true);
 expect(html.includes('Rp 0')).toBe(false);
 expect(html.includes('Riwayat jurnal berulang perlu ditinjau')).toBe(false);
});

it('does not let source-schedule receipts exhaust the legacy history cap',async()=>{
 const source='f3000000-0000-4000-8000-000000000006';
 fixture.tables.recurring_journals=[
  {id:target,nama:'Legacy schedule',day_of_month:1,branch_id:null,is_active:true,max_occurrences:1,last_posted:'1800-01',lines:[]},
  {id:source,nama:'Jurnal dari sumber',day_of_month:25,branch_id:null,is_active:true,max_occurrences:1,last_posted:null,is_source_schedule:true,lines:[]},
 ];
 fixture.tables.recurring_journal_sources=[{id:source,source_entry_id:'f3000000-0000-4000-8000-000000000007',branch_id:null,
  source_snapshot:{entry_id:'f3000000-0000-4000-8000-000000000007',no_jurnal:'JU-1043',lines:[{debit:100,credit:0},{debit:0,credit:100}]},
  config:{name:'Jadwal besar',first_period:'2026-11',last_period:'2026-11',day:25,count:1,mode:'manual'}}];
 fixture.tables.journal_entries=[
  ...Array.from({length:10001},(_,i)=>({id:`source-history-${i}`,no_jurnal:`JU-S-${i}`,tanggal:'2026-11-25',source:'recurring',source_ref:`${source}:2026-11`,branch_id:null,journal_lines:[{debit:100,credit:0},{debit:0,credit:100}]})),
  {id:'legacy-history',no_jurnal:'JU-LEGACY',tanggal:'1800-01-01',source:'recurring',source_ref:`${target}:1800-01`,branch_id:null,journal_lines:[{debit:100,credit:0},{debit:0,credit:100}]},
 ];
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));
 expect(html.includes('role="alert"')).toBe(false);
 expect(html.includes('1 / 1 kali')).toBe(true);
 expect(html.includes('1 / 1 periode')).toBe(false);
 expect(html.includes('Lihat periode')).toBe(true);
});

it('keeps ambiguous abbreviated legacy references visible for review',async()=>{
 fixture.tables.journal_entries=[{id:'ambiguous-legacy-history',no_jurnal:'JU-AMBIGUOUS',tanggal:'1800-01-01',source:'recurring',source_ref:'f3000000-1800-01',branch_id:null,journal_lines:[{debit:100,credit:0},{debit:0,credit:100}]}];
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));
 expect(html.includes('Riwayat jurnal berulang perlu ditinjau')).toBe(true);
 expect(html.includes('Perlu ditinjau')).toBe(true);
});

it('does not expose or infer source values when the private proof is unavailable',async()=>{
 const source='f3000000-0000-4000-8000-000000000005';
 fixture.tables.recurring_journals=[{id:source,nama:'Jurnal dari sumber',day_of_month:25,branch_id:null,is_active:true,max_occurrences:12,last_posted:null,is_source_schedule:true,lines:[]}];
 fixture.tables.recurring_journal_sources=[];
 fixture.tables.journal_entries=[];
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));
 expect(html.includes('Jadwal sumber (rincian tidak tersedia)')).toBe(true);
 expect(html.includes('Perlu ditinjau')).toBe(true);
 expect(html.includes('Rp 0')).toBe(false);
 expect(html.includes('Lihat periode')).toBe(false);
});
