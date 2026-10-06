import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({tables:{} as Record<string,Record<string,unknown>[]>,failed:false}));
vi.stubGlobal('React',React);
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({from(table:string){
 let counted=false,bounds:[number,number]|undefined;
 const query={select(_fields:string,options?:{count:string}){counted=options?.count==='exact';return query;},order(){return query;},eq(){return query;},returns(){return query;},range(from:number,to:number){bounds=[from,to];return query;},then(resolve:(value:unknown)=>unknown){
 const all=fixture.tables[table]??[];
 return Promise.resolve({data:fixture.failed&&table==='journal_entries'?null:bounds?all.slice(bounds[0],bounds[1]+1):all.slice(0,1000),count:counted?all.length:null,error:fixture.failed&&table==='journal_entries'?{message:'private DB detail'}:null}).then(resolve);
 }};return query;
}})}));
vi.mock('@/app/(app)/keuangan/jurnal-berulang/actions',()=>({toggleRecurring:async()=>{},createRecurring:async()=>{}}));
vi.mock('@/app/(app)/keuangan/jurnal-berulang/RecurringForm',()=>({RecurringForm:()=>null}));
import Page from '@/app/(app)/keuangan/jurnal-berulang/page';
const target='f3000000-0000-4000-8000-000000000001',other='f3000000-0000-4000-8000-000000000002';
beforeEach(()=>{fixture.failed=false;fixture.tables={
 recurring_journals:[{id:target,nama:'Completed old schedule',day_of_month:1,branch_id:null,is_active:true,max_occurrences:1,last_posted:'1800-01',lines:[]},{id:other,nama:'Other schedule',day_of_month:1,branch_id:null,is_active:true,max_occurrences:null,last_posted:null,lines:[]}],
 journal_entries:[...Array.from({length:1000},(_,i)=>{const period=`${1900+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`;return {id:`history-${i}`,no_jurnal:`JRN-${i}`,tanggal:`${period}-01`,source_ref:`${other}:${period}`,branch_id:null,journal_lines:[{debit:100,credit:0},{debit:0,credit:100}]};}),{id:'old-target',no_jurnal:'JRN-OLD',tanggal:'1800-01-01',source_ref:`${target}:1800-01`,branch_id:null,journal_lines:[{debit:100,credit:0},{debit:0,credit:100}]}],coa_accounts:[],branches:[]};});
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
