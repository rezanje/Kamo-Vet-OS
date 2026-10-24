import { ActivityNavigationProvider } from '../ActivityHistoryLink';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({from:vi.fn(),calls:[] as unknown[][],rootMissing:false,relatedError:false,denied:false,replacementVisible:false,salesLegacy:false,salesCorrected:false}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'user'}}})},from:m.from})}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('NOT_FOUND')}}));
vi.mock('@/components/dokumen/DokumenPanel',()=>({DokumenPanel:()=>null}));
vi.mock('@/app/(app)/pembelian/[id]/POCorrectionForm',()=>({POEditForm:()=>null,POCancelForm:()=>null}));
vi.mock('@/app/(app)/pembelian/faktur/[id]/InvoiceCorrectionForm',()=>({InvoiceCorrectionForm:()=>null}));
vi.mock('@/app/(app)/pembelian/faktur/[id]/PaymentCorrectionForm',()=>({PaymentCorrectionForm:()=>null}));
vi.mock('@/app/(app)/penjualan/faktur/[id]/WholesaleCorrectionForm',()=>({WholesaleCorrectionForm:()=>null}));
import PO from '@/app/(app)/pembelian/[id]/page';
import Invoice from '@/app/(app)/pembelian/faktur/[id]/page';
import Receipt from '@/app/(app)/pembelian/penerimaan/[id]/page';
import SalesInvoice from '@/app/(app)/penjualan/faktur/[id]/page';
const id=(n:number)=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const po={id:id(1),no_po:'PO-1',tanggal:'2026-10-22',status:'Diterima',total:100,revision:0,branch_id:id(99),purchase_order_items:[],goods_receipts:[{id:id(2),no_terima:'GR-ONE',tanggal:'2026-10-22'},{id:id(3),no_terima:'GR-TWO',tanggal:'2026-10-22'}],purchase_advances:[{id:id(4),no_um:'DP-ONE',status:'aktif'}],po_payments:[],purchase_returns:[]};
const payment=(n:number,extra={})=>({id:id(n),tanggal:'2026-10-22',amount:10,metode:'Transfer',revision:0,advance_id:null,advance:null,payment_order_id:null,payment_order:null,reversal_of:null,replaces_payment_id:null,voided_at:null,...extra});
beforeEach(()=>{
 m.calls=[];m.rootMissing=false;m.relatedError=false;m.denied=false;m.replacementVisible=false;m.salesLegacy=false;m.salesCorrected=false;
 m.from.mockImplementation((table:string)=>{
 const filters:Record<string,unknown>={};let single=false;
 const q:Record<string,unknown>={then:(resolve:(x:unknown)=>void)=>{
  let data:unknown=[];let error:unknown=null;
  if(table==='profiles')data={role:'ADMIN',is_active:true};
  if(table==='purchase_orders')data=m.rootMissing?null:po;
  if(table==='goods_receipts')data=!single?[{id:id(2),no_terima:'GR-ONE'},{id:id(3),no_terima:'GR-TWO'}]:m.rootMissing?null:{id:id(2),po_id:id(1),no_terima:'GR-ONE',tanggal:'2026-10-22',purchase_orders:m.denied?null:{id:id(1),no_po:'PO-1',status:'Diterima'},goods_receipt_items:[]};
  if(table==='purchase_returns')data=m.denied?[]:[{id:id(31),no_retur:'RB-ONE',voided_at:null}];
  if(table==='purchase_invoices'){
   data=single&&filters.id===id(10)?{id:id(10),no_faktur:'INV-1',total:100,tanggal:'2026-10-22',jatuh_tempo:'2026-11-22',revision:0,voided_at:m.replacementVisible?'2026-10-22':null,po_id:id(1),purchase_orders:m.denied?null:po,replaces_invoice_id:id(20),original:m.denied?null:{id:id(20),no_faktur:'INV-ORIGINAL',voided_at:'2026-10-22'},purchase_invoice_items:[],purchase_invoice_payments:[payment(11,{voided_at:'2026-10-22'}),payment(12,{reversal_of:id(11),amount:-10}),payment(13,{replaces_payment_id:id(11),advance_id:id(4),advance:m.denied?null:{id:id(4),no_um:'DP-ONE',status:'aktif'},payment_order_id:id(30),payment_order:m.denied?null:{id:id(30),no_pp:'PP-ONE',status:'dibayar'}})]}:single?(filters.id===id(20)&&!m.denied?{id:id(20),no_faktur:'INV-ORIGINAL',voided_at:'2026-10-22'}:m.replacementVisible&&filters.replaces_invoice_id?{id:id(21),no_faktur:'INV-REPLACEMENT',voided_at:null}:null):[{id:id(10),no_faktur:'INV-1',voided_at:null}];
   if(m.rootMissing&&single&&filters.id===id(10))data=null;
   if(m.relatedError&&!single){data=null;error={message:'PRIVATE database detail'}}
  }
  if(table==='sales_invoices')data=single&&m.rootMissing?null:single?{id:id(40),no_faktur:'SI-1',order_id:id(50),replaces_invoice_id:m.salesLegacy?id(90):m.salesCorrected?id(45):null,total:100,carried_paid:0,revision:0,status:'aktif',tanggal:'2026-10-22',jatuh_tempo:'2026-11-22',customers:null}: [{id:id(40),no_faktur:'SI-1',total:100,carried_paid:0,status:'aktif',replaces_invoice_id:m.salesLegacy?id(90):m.salesCorrected?id(45):null,sales_receipts:[{id:id(41),no_terima:'SPLIT-CASH',tanggal:'2026-10-22',jumlah:20,metode:'Tunai',advance_id:null},{id:id(42),no_terima:'SPLIT-DP',tanggal:'2026-10-22',jumlah:30,metode:'Transfer',dari_uang_muka:10,advance_id:id(43),advance:m.denied?null:{id:id(43),no_um:'SALES-DP',status:'aktif'}}]}];
  if(table==='sales_invoices'&&!single&&m.salesCorrected)data=[...(data as unknown[]),{id:id(45),no_faktur:'SI-ORIGINAL',status:'batal',carried_paid:0,replaces_invoice_id:null,sales_receipts:[{id:id(46),no_terima:'OLD-RECEIPT',tanggal:'2026-10-21',jumlah:30,metode:'Transfer'}]}];
  if(table==='sales_receipts')data=[{id:id(41),invoice_id:id(40),no_terima:'SPLIT-CASH',tanggal:'2026-10-22',jumlah:20,metode:'Tunai',advance_id:null},{id:id(42),invoice_id:id(40),no_terima:'SPLIT-DP',tanggal:'2026-10-22',jumlah:30,metode:'Transfer',dari_uang_muka:10,advance_id:id(43),advance:m.denied?null:{id:id(43),no_um:'SALES-DP',status:'aktif'}},...(m.salesCorrected?[{id:id(46),invoice_id:id(45),no_terima:'OLD-RECEIPT',tanggal:'2026-10-21',jumlah:30,metode:'Transfer'}]:[])].filter(r=>Array.isArray(filters.invoice_id)&&filters.invoice_id.includes(r.invoice_id));
  if(table==='company_settings')data={ppn_rate:11};
  resolve({data,error,count:Array.isArray(data)?data.length:null});
 }};
 for(const name of ['select','eq','in','order','range','maybeSingle'])q[name]=(...args:unknown[])=>{m.calls.push([table,name,...args]);if(name==='eq'||name==='in')filters[String(args[0])]=args[1];if(name==='maybeSingle')single=true;return q};return q;
 });
});
it('opens every stored receipt and DP from its PO without searching',async()=>{
 const html=renderToStaticMarkup(await PO({params:Promise.resolve({id:id(1)}),searchParams:Promise.resolve({})}));
 expect(html).toContain('/pembelian/penerimaan/'+id(2));expect(html).toContain('/pembelian/penerimaan/'+id(3));expect(html).toContain('GR-ONE');expect(html).toContain('GR-TWO');expect(html).toContain('/pembelian/uang-muka?');expect(html).toContain('#advance-'+id(4));expect(html).toContain('DP-ONE');
 expect(m.calls).toContainEqual(['purchase_invoices','eq','po_id',id(1)]);
});
it('opens the PO and invoices of the same PO from a receipt without pretending direct allocation exists',async()=>{
 const html=renderToStaticMarkup(await Receipt({params:Promise.resolve({id:id(2)})}));
 expect(html).toContain('/pembelian/'+id(1));expect(html).toContain('/pembelian/faktur/'+id(10));expect(html).toContain('PO yang sama');expect(m.calls).toContainEqual(['purchase_invoices','eq','po_id',id(1)]);
});
it('retains every purchase payment, cancellation, reversal, replacement, DP and precise order destination',async()=>{
 const html=renderToStaticMarkup(await Invoice({params:Promise.resolve({id:id(10)}),searchParams:Promise.resolve({})}));
 for(const n of [11,12,13])expect(html).toContain('id="payment-'+id(n)+'"');
 expect(html).toContain('#payment-'+id(11));expect(html).toContain('#payment-'+id(13));expect(html).toContain('Pembalik pembayaran');expect(html).toContain('Pembayaran dibatalkan');expect(html).toContain('Pembayaran pengganti');expect(html).toContain('#advance-'+id(4));expect(html).toContain('#payment-order-'+id(30));expect(html).toContain('PP-ONE');
});
it('shows purchase returns sharing the invoice PO without claiming receipt allocation',async()=>{
 const html=renderToStaticMarkup(await Invoice({params:Promise.resolve({id:id(10)}),searchParams:Promise.resolve({})}));
 expect(html).toContain('/pembelian/retur/'+id(31));
 expect(html).toContain('RB-ONE');
 expect(html).toContain('PO yang sama');
 expect(m.calls).toContainEqual(['purchase_returns','eq','po_id',id(1)]);
});
it('opens every split sales receipt and its explicitly allocated DP',async()=>{
 const html=renderToStaticMarkup(await SalesInvoice({params:Promise.resolve({id:id(40)}),searchParams:Promise.resolve({})}));
 for(const n of [41,42]){expect(html).toContain('id="receipt-'+id(n)+'"');expect(html).toContain('#receipt-'+id(n));}
 expect(html).toContain('#advance-'+id(43));expect(html).toContain('SALES-DP');expect(html).toContain('SPLIT-CASH');expect(html).toContain('SPLIT-DP');
});
it('does not manufacture links or reveal hidden source document numbers',async()=>{
 m.denied=true;
 const html=renderToStaticMarkup(await Invoice({params:Promise.resolve({id:id(10)}),searchParams:Promise.resolve({})}));
 expect(html).not.toContain('INV-ORIGINAL');expect(html).not.toContain('PP-ONE');expect(html).not.toContain('DP-ONE');expect(html).toContain('tidak tersedia atau tidak dapat diakses');
 const receipt=renderToStaticMarkup(await Receipt({params:Promise.resolve({id:id(2)})}));
 expect(receipt).not.toContain('/pembelian/faktur/'+id(10));expect(receipt).not.toContain('PO-1');
});
it('distinguishes related-query failure from no related documents without exposing internals',async()=>{
 m.relatedError=true;
 const html=renderToStaticMarkup(await Receipt({params:Promise.resolve({id:id(2)})}));
 expect(html).toContain('belum dapat dimuat');expect(html).not.toContain('PRIVATE database detail');
});
it('does not load related documents if root receipt is unavailable',async()=>{
 m.rootMissing=true;await expect(Receipt({params:Promise.resolve({id:id(2)})})).rejects.toThrow('NOT_FOUND');expect(m.calls.some(c=>c[0]==='purchase_invoices')).toBe(false);
});

it('links original and replacement only from stored provenance and labels their status',async()=>{
 m.replacementVisible=true;
 const html=renderToStaticMarkup(await Invoice({params:Promise.resolve({id:id(10)}),searchParams:Promise.resolve({})}));
 expect(html).toContain('Faktur asal INV-ORIGINAL');expect(html).toContain('Faktur pengganti INV-REPLACEMENT');expect(html).toContain('/pembelian/faktur/'+id(20));expect(html).toContain('/pembelian/faktur/'+id(21));expect(html).not.toContain('Siapkan faktur pengganti');
 expect(m.calls).toContainEqual(['purchase_invoices','eq','replaces_invoice_id',id(10)]);
});

it('stops child reads when the invoice is not readable in the current scope',async()=>{
 m.rootMissing=true;await expect(Invoice({params:Promise.resolve({id:id(10)}),searchParams:Promise.resolve({})})).rejects.toThrow('NOT_FOUND');
 expect(m.calls.some(c=>c[0]==='goods_receipts')).toBe(false);expect(m.calls.some(c=>c[1]==='eq'&&c[2]==='replaces_invoice_id')).toBe(false);
});

it('labels unavailable sales lineage without inventing an ancestor link or losing own split receipts',async()=>{
 m.salesLegacy=true;
 const html=renderToStaticMarkup(await SalesInvoice({params:Promise.resolve({id:id(40)}),searchParams:Promise.resolve({})}));
 expect(html).toContain('Faktur asal tidak tersedia atau tidak dapat diakses');expect(html).toContain('tidak direkonstruksi');expect(html).not.toContain('/penjualan/faktur/'+id(90));expect(html).toContain('SPLIT-CASH');expect(html).toContain('SPLIT-DP');
});

it('keeps predecessor receipts under their actual source invoice and provides a return to the replacement',async()=>{
 m.salesCorrected=true;
 const html=renderToStaticMarkup(await SalesInvoice({params:Promise.resolve({id:id(40)}),searchParams:Promise.resolve({})}));
 expect(html).toContain('SI-ORIGINAL');expect(html).toContain('OLD-RECEIPT');expect(html).toContain('id="receipt-'+id(46)+'"');expect(html).toContain('/penjualan/faktur/'+id(45)+'?from=');expect(html).toContain('#receipt-'+id(46));expect(html).toContain('faktur asal dibatalkan');
});

it.each([
 ['purchase order',PO,1,'purchase_orders'],
 ['purchase invoice',Invoice,10,'purchase_invoices'],
 ['sales invoice',SalesInvoice,40,'sales_invoices'],
] as const)('preserves %s activity history together with stored document navigation',async(_label,Page,n,entity)=>{
 const page=await Page({params:Promise.resolve({id:id(n)}),searchParams:Promise.resolve({})});
 const allowed=renderToStaticMarkup(<ActivityNavigationProvider allowed>{page}</ActivityNavigationProvider>);
 expect(allowed).toContain(`entity=${entity}&amp;object=${id(n)}`);
 expect(allowed).toContain(n===40?'#receipt-':n===10?'#payment-':'GR-ONE');
 const denied=renderToStaticMarkup(<ActivityNavigationProvider allowed={false}>{page}</ActivityNavigationProvider>);
 expect(denied).not.toContain('Riwayat aktivitas');
});
it('retains per-payment and per-receipt audit links alongside their document anchors',async()=>{
 const invoice=await Invoice({params:Promise.resolve({id:id(10)}),searchParams:Promise.resolve({})});
 const purchase=renderToStaticMarkup(<ActivityNavigationProvider allowed>{invoice}</ActivityNavigationProvider>);
 expect(purchase).toContain(`entity=purchase_invoice_payments&amp;object=${id(13)}`);expect(purchase).toContain(`id="payment-${id(13)}"`);
 const salesPage=await SalesInvoice({params:Promise.resolve({id:id(40)}),searchParams:Promise.resolve({})});
 const sales=renderToStaticMarkup(<ActivityNavigationProvider allowed>{salesPage}</ActivityNavigationProvider>);
 expect(sales).toContain(`entity=sales_receipts&amp;object=${id(41)}`);expect(sales).toContain(`id="receipt-${id(41)}"`);
});
