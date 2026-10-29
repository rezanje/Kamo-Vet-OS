import{renderToStaticMarkup}from 'react-dom/server';import{beforeEach,expect,it,vi}from 'vitest';
const s=vi.hoisted(()=>({missing:false,fail:'',calls:[]as unknown[][]}));
const old='a0000000-0000-4000-8000-000000000001',current='a0000000-0000-4000-8000-000000000002';
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('NOT_FOUND')}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({from(table:string){const filters:Record<string,unknown>={};const q={select:()=>q,eq:(key:string,value:unknown)=>{filters[key]=value;s.calls.push([table,key,value]);return q;},is:()=>q,order:()=>q,limit:()=>q,maybeSingle:()=>q,
 then(resolve:(r:unknown)=>unknown){const id=filters.id??current;const invoice={id,invoice_no:id===old?'INV-REQUESTED':'INV-CURRENT',total:100,subtotal:100,discount:0,tax:0,dp_amount:0,paid_status:'Lunas',created_at:'2026-10-23T00:00:00Z'};
 const data=table==='visits'?{id:'visit',poli:'Clinic',created_at:'2026-10-23T00:00:00Z'}:table==='invoices'?(s.missing&&filters.id?null:invoice):table==='clinic_demo_invoice_snapshots'?null:[];
 return Promise.resolve({data:s.fail===table?null:data,error:s.fail===table?{message:'Private failure'}:null}).then(resolve);
 }};return q;}})}));
import Page from '@/app/(app)/klinik/pembayaran/[visitId]/invoice/page';
const render=async(invoice_id?:string)=>renderToStaticMarkup(await Page({params:Promise.resolve({visitId:'visit'}),searchParams:Promise.resolve({invoice_id})}));
beforeEach(()=>{s.missing=false;s.fail='';s.calls=[];});
it('opens the explicit invoice source rather than the current invoice of the same visit',async()=>{const html=await render(old);expect(html).toContain('INV-REQUESTED');expect(html).not.toContain('INV-CURRENT');expect(s.calls).toContainEqual(['invoices','visit_id','visit']);expect(s.calls).toContainEqual(['invoices','id',old]);});
it('does not fall back when the requested source is missing or no longer active',async()=>{s.missing=true;await expect(render(old)).rejects.toThrow('NOT_FOUND');});
it('preserves the existing current invoice print route without a source parameter',async()=>{expect(await render()).toContain('INV-CURRENT');});
it('rejects malformed source selectors instead of ignoring them',async()=>{await expect(render('../current')).rejects.toThrow('NOT_FOUND');});
it.each(['visits','invoices','invoice_items','invoice_payments'])('stops printing on unknown %s source',async table=>{s.fail=table;await expect(render(old)).rejects.toThrow('belum');});
