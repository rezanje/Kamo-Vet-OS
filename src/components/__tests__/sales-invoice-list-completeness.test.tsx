import React from 'react';
import{renderToStaticMarkup}from 'react-dom/server';
import{beforeEach,expect,it,vi}from 'vitest';
const s=vi.hoisted(()=>({fail:'',calls:[]as {table:string;from:number;to:number}[],missingCount:false}));
vi.mock('next/link',()=>({default:({children,...p}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...p}>{children}</a>}));
vi.mock('@/components/MasterPage',()=>({MasterPage:({children}:React.PropsWithChildren)=><main>{children}</main>}));
vi.mock('@/components/PilihRekening',()=>({loadRekeningAktif:async()=>[],PilihRekening:()=>null}));
vi.mock('@/lib/master-guard',()=>({bolehTransaksiKas:async()=>false}));
vi.mock('@/app/(app)/penjualan/faktur/actions',()=>({terimaPembayaranJual:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({
 auth:{getUser:async()=>({data:{user:{id:'actor'}}})},
 from(table:string){let first=0,last=999,ids:string[]|undefined,select='';
  const q={select:(v:string)=>{select=v;return q;},eq:()=>q,is:()=>q,gt:()=>q,order:()=>q,in:(_key:string,v:string[])=>{ids=v;return q;},range:(a:number,b:number)=>{first=a;last=b;return q;},
   then(resolve:(v:unknown)=>unknown){
    let rows:Record<string,unknown>[]=[];
    if(table==='sales_invoices')rows=Array.from({length:1001},(_,i)=>({id:`w${i}`,no_faktur:`INV-W-${String(i).padStart(4,'0')}`,tanggal:'2026-10-23',jatuh_tempo:'2026-10-23',total:2000,carried_paid:0,status:'aktif',kategori:'selisih_stok',customers:{name:'Fictional customer'},sales_receipts:select.includes('sales_receipts(')?Array.from({length:i===0?1000:0},()=>({jumlah:1})):undefined}));
    if(table==='invoices')rows=Array.from({length:1001},(_,i)=>({id:`c${i}`,visit_id:`visit${i}`,invoice_no:`INV-C-${String(i).padStart(4,'0')}`,created_at:'2026-10-23T00:00:00Z',total:2000,dp_amount:0,paid_status:'Belum Lunas',visits:{pets:{name:'Fictional pet'},customers:{name:'Fictional customer'},branches:{name:'Fictional branch'}},invoice_payments:select.includes('invoice_payments(')?Array.from({length:i===0?1000:0},()=>({amount:1})):undefined}));
    if(table==='sales_receipts')rows=Array.from({length:1001},(_,i)=>({id:`r${i}`,invoice_id:'w0',jumlah:1}));
    if(table==='invoice_payments')rows=Array.from({length:1001},(_,i)=>({id:`p${i}`,invoice_id:'c0',amount:1}));
    if(ids)rows=rows.filter(r=>ids!.includes(String(r.invoice_id)));
    s.calls.push({table,from:first,to:last});
    if(s.fail===table||s.fail===`${table}:late`&&first>0)return Promise.resolve({data:null,error:{message:'Fictional private failure'},count:null}).then(resolve);
    return Promise.resolve({data:rows.slice(first,Math.min(last,first+999)+1),error:null,count:s.missingCount?undefined:rows.length}).then(resolve);
   }};return q;
 }
})}));
import Page from '@/app/(app)/penjualan/faktur/page';
const render=async()=>renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));
beforeEach(()=>{s.fail='';s.calls=[];s.missingCount=false;});
it('shows the1001st wholesale and clinic invoice instead of accepting the default API cap',async()=>{const html=await render();expect(html.includes('INV-W-1000')).toBe(true);expect(html.includes('INV-C-1000')).toBe(true);});
it('uses all1001 payments for displayed source balances without double counting embedded rows',async()=>{
 const html=await render();for(const key of['INV-W-0000','INV-C-0000']){const start=html.indexOf(key);expect(html.slice(start,html.indexOf('</tr>',start))).toContain('Rp 999');}
 expect(s.calls.filter(c=>['invoice_payments','sales_receipts'].includes(c.table)).every(c=>c.to-c.from<500)).toBe(true);
});
it.each(['sales_invoices','invoices:late','sales_receipts:late','invoice_payments:late','sales_advances','wholesale_invoice_corrections'])('refuses an incomplete %s read instead of presenting empty or paid data',async table=>{s.fail=table;await expect(render()).rejects.toThrow(/belum|tidak dapat/);});
it('refuses missing source counts instead of assuming completeness',async()=>{s.missingCount=true;await expect(render()).rejects.toThrow('jumlah data tidak dapat diverifikasi');});
