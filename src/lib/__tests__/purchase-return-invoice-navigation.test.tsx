import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
const id=(n:number)=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const state=vi.hoisted(()=>({invoicesVisible:true}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('NOT_FOUND')}}));
vi.mock('@/components/returns/ReturnCorrectionForm',()=>({ReturnCorrectionForm:()=>null}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'actor'}}})},from:(table:string)=>{
 const rows:Record<string,unknown>={
  purchase_returns:{id:'10000000-0000-4000-8000-000000000031',no_retur:'RB-ONE',po_id:'10000000-0000-4000-8000-000000000001',tanggal:'2026-10-24',total:10,revision:0},
  purchase_return_items:[],profiles:{role:'ADMIN',is_active:true},return_record_postings:null,return_record_corrections:null,
  purchase_invoices:state.invoicesVisible?[{id:'10000000-0000-4000-8000-000000000010',no_faktur:'FP-ONE',voided_at:null}]:[]
 };
 const q={select:()=>q,eq:()=>q,order:()=>q,maybeSingle:async()=>({data:rows[table]??null,error:null}),then:(resolve:(x:unknown)=>void)=>resolve({data:rows[table]??[],error:null})};return q;
}})}));
import { ReturnRecordDetail } from '@/components/returns/ReturnRecordDetail';
it('links invoices from a purchase return through its stored PO without claiming direct allocation',async()=>{
 const html=renderToStaticMarkup(await ReturnRecordDetail({kind:'purchase',id:id(31)}));
 expect(html).toContain('/pembelian/faktur/'+id(10));
 expect(html).toContain('FP-ONE');
 expect(html).toContain('PO yang sama');
});
it('does not expose invoice numbers hidden by RLS',async()=>{
 state.invoicesVisible=false;
 const html=renderToStaticMarkup(await ReturnRecordDetail({kind:'purchase',id:id(31)}));
 expect(html).not.toContain('FP-ONE');
});
