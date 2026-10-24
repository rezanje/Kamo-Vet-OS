import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
const id='10000000-0000-4000-8000-000000000001';
const state=vi.hoisted(()=>({focused:false,quoteLookups:0,journalId:'',journalNo:''}));
vi.mock('@/lib/master-guard',()=>({bolehTransaksiKas:async()=>false}));
vi.mock('@/lib/checked-list',()=>({readCompleteList:async()=>[]}));
vi.mock('@/lib/satuan',()=>({loadItemUnits:async()=>new Map()}));
vi.mock('@/lib/recurring',()=>({postRecurringCatchUp:async()=>[]}));
vi.mock('@/app/(app)/keuangan/jurnal/JurnalForm',()=>({JurnalForm:()=>null}));
vi.mock('@/app/(app)/keuangan/jurnal/JurnalCorrectionForm',()=>({JurnalCorrectionForm:()=>null}));
vi.mock('@/components/NoDok',()=>({NoDok:()=>null}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'actor'}}})},from:(table:string)=>{
 const quote={id:'10000000-0000-4000-8000-000000000001',no_penawaran:'SQ.2026.10.00001',tanggal:'2026-10-24',total:100,status:'dikirim',sales_orders:[],customers:null};
 const journal={id:'10000000-0000-4000-8000-000000000001',no_jurnal:'JRN.2026.10.00001',tanggal:'2026-10-24',deskripsi:'Fiksi',source:'sale',source_ref:null,journal_lines:[{debit:100,credit:0,coa_accounts:{code:'1101',name:'Kas'}},{debit:0,credit:100,coa_accounts:{code:'4101',name:'Pendapatan'}}]};
 const q={select:()=>q,eq:(field:string,value:string)=>{if(table==='sales_quotations'&&field==='id')state.quoteLookups++;if(table==='journal_entries'&&field==='id')state.journalId=value;if(table==='journal_entries'&&field==='no_jurnal')state.journalNo=value;return q;},order:()=>q,limit:()=>q,maybeSingle:async()=>({data:quote,error:null}),then:(resolve:(value:unknown)=>void)=>resolve({data:table==='sales_quotations'?state.focused?[]:[quote]:table==='journal_entries'&&(state.journalId===journal.id||state.journalNo===journal.no_jurnal)?[journal]:[],error:null})};return q;
}})}));
import QuotationPage from '@/app/(app)/penjualan/penawaran/page';
import JournalPage from '@/app/(app)/keuangan/jurnal/page';
it('loads an older quotation omitted by the newest 200 rows',async()=>{
 state.focused=true;state.quoteLookups=0;
 const html=renderToStaticMarkup(await QuotationPage({searchParams:Promise.resolve({quotation:id})}));
 expect(html).toContain(`id="quotation-${id}"`);
 expect(html).toContain('SQ.2026.10.00001');
 expect(state.quoteLookups).toBe(1);
});
it('opens the exact journal and expands its account lines',async()=>{
 state.journalId='';state.journalNo='';
 const html=renderToStaticMarkup(await JournalPage({searchParams:Promise.resolve({entry:id})}));
 expect(state.journalId).toBe(id);
 expect(html).toContain(`id="journal-${id}"`);
 expect(html).toContain('JRN.2026.10.00001');
 expect(html).toContain('<details open="">');
});
it('finds a numbered journal directly from a FINANCE-allowed link',async()=>{
 state.journalId='';state.journalNo='';
 const number='JRN.2026.10.00001';
 const html=renderToStaticMarkup(await JournalPage({searchParams:Promise.resolve({nomor:number})}));
 expect(state.journalNo).toBe(number);
 expect(html).toContain('id="selected-journal"');
 expect(html).toContain('<details open="">');
});
