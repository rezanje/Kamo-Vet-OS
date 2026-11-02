import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,expect,it,vi} from 'vitest';

// Kasus Chloe (Klinik TKI, 2 Nov 2026): tagihan rawat inap bertahap dilunasi dengan kartu
// lewat kwitansi -> uang muka. Label kepala invoice tetap "Tunai" (pengisi), sehingga struk
// dan invoice mencetak "Tunai". Cetakan harus menyebut cara bayar sebenarnya.
const state=vi.hoisted(()=>({stage:true,receiptStatus:'aktif'}));
vi.mock('next/link',()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('not found')}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({from(table:string){
 const invoice={id:'inv',invoice_no:'INV-202611-0125',subtotal:919000,discount:0,tax:0,total:919000,dp_amount:0,paid_status:'Lunas',metode_bayar:'Tunai',stage_billing:state.stage,paid_at:'2026-11-02T10:06:36Z',created_at:'2026-11-02T10:06:36Z',cashier_name:'Kasir Fiktif'};
 const visit={id:'visit',poli:'Poli Umum',doctor_id:null,dokter:'Dokter Fiktif',created_at:'2026-11-01T09:23:26Z',pets:{name:'Chloe',species:'Kucing'},customers:{name:'Pemilik Fiktif'},branches:{name:'Cabang Fiktif'}};
 const rows=table==='invoice_items'?[{deskripsi:'Rawat Inap Cat',jenis:'jasa',qty:7,harga:95000,diskon_persen:0}]
  :table==='invoice_payments'?[{id:'pay',invoice_id:'inv',amount:919000,metode:'Uang Muka',transferred_from:null}]
  :table==='clinic_advance_applications'?[{invoice_id:'inv',advance_id:'umk',released_at:null}]
  :table==='clinic_customer_advances'?[{id:'umk',receipt_id:'kwt'}]
  :table==='clinic_payment_receipts'?[{id:'kwt',status:state.receiptStatus,clinic_payment_receipt_parts:[{metode:'Kredit'}]}]
  :table==='invoices'?[invoice]:table==='visits'?[visit]:[];
 const result={data:rows,error:null};
 const q={select:()=>q,eq:()=>q,is:()=>q,in:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:table==='visits'?visit:table==='invoices'?invoice:null,error:null,count:1}),then:(resolve:(value:unknown)=>void)=>Promise.resolve(result).then(resolve)};return q;
}})}));
import Struk from '@/app/(app)/klinik/pembayaran/[visitId]/struk/page';
import Invoice from '@/app/(app)/klinik/pembayaran/[visitId]/invoice/page';
const DOKUMEN=[['struk',Struk,/<span>Metode<\/span><span>([^<]+)</],['invoice',Invoice,/Metode pembayaran: <b[^>]*>([^<]+)</]] as const;
beforeEach(()=>{state.stage=true;state.receiptStatus='aktif'});

it.each(DOKUMEN)('%s of a staged inpatient invoice paid by card prints the card method, not Tunai',async(_n,Page,label)=>{
 const html=renderToStaticMarkup(await Page({params:Promise.resolve({visitId:'visit'})}));
 expect(html.match(label)?.[1]).toBe('Kredit');
});
it.each(DOKUMEN)('%s of an ordinary invoice keeps its stored header method',async(_n,Page,label)=>{
 state.stage=false;
 const html=renderToStaticMarkup(await Page({params:Promise.resolve({visitId:'visit'})}));
 expect(html.match(label)?.[1]).toBe('Tunai');
});
it.each(DOKUMEN)('%s falls back to the header when the source receipt was cancelled',async(_n,Page,label)=>{
 state.receiptStatus='batal';
 const html=renderToStaticMarkup(await Page({params:Promise.resolve({visitId:'visit'})}));
 expect(html.match(label)?.[1]).toBe('Tunai');
});
