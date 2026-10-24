import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({table:'',extra:null as string|null,failed:false,queries:[]as string[]}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({from:(table:string)=>{state.queries.push(table);const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:state.failed?null:table===state.table?{id:'10000000-0000-4000-8000-000000000001',visit_id:state.extra,order_id:state.extra,invoice_id:state.extra}:null,error:state.failed?{message:'private fixture'}:null})};return q;}})}));
vi.mock('next/navigation',()=>({redirect:(path:string)=>{throw Error(path);}}));
import Resolver from '@/app/(app)/dokumen/[no]/page';
const id='10000000-0000-4000-8000-000000000001';
beforeEach(()=>{state.table='';state.extra=null;state.failed=false;state.queries=[];});
it.each([
 ['sales_invoices',`/penjualan/faktur/${id}`],['sales_returns',`/penjualan/retur/${id}`],
 ['purchase_returns',`/pembelian/retur/${id}`],['goods_receipts',`/pembelian/penerimaan/${id}`],
 ['sales_deliveries',`/penjualan/pengiriman?delivery=${id}#delivery-${id}`],
 ['sales_advances',`/penjualan/uang-muka#advance-${id}`],
])('opens the exact saved %s document rather than an unfiltered list',async(table,path)=>{
 state.table=table;await expect(Resolver({params:Promise.resolve({no:'FICTION.2026.00001'})})).rejects.toThrow(path);
});
it('preserves actual clinical visit ownership when invoice id differs from visit id',async()=>{state.table='invoices';state.extra='20000000-0000-4000-8000-000000000002';await expect(Resolver({params:Promise.resolve({no:'FICTION.2026.00001'})})).rejects.toThrow(`/klinik/pembayaran/${state.extra}/invoice`);});
it('opens a numbered sales receipt at its stored invoice and exact receipt row',async()=>{
 state.table='sales_receipts';state.extra='20000000-0000-4000-8000-000000000002';
 await expect(Resolver({params:Promise.resolve({no:'RC.2026.10.00001'})})).rejects.toThrow(`/penjualan/faktur/${state.extra}#receipt-${id}`);
});
it('opens a numbered payment order at its saved page anchor',async()=>{
 state.table='payment_orders';
 await expect(Resolver({params:Promise.resolve({no:'PP.2026.10.00001'})})).rejects.toThrow(`/pembelian/perintah-bayar?order=${id}#payment-order-${id}`);
});
it('does not present a failed source lookup as a verified missing document',async()=>{state.failed=true;const html=renderToStaticMarkup(await Resolver({params:Promise.resolve({no:'FICTION.2026.00001'})}));expect(html).toContain('DOKUMEN BELUM DAPAT DIPERIKSA');expect(html).not.toContain('private fixture');expect(state.queries).toHaveLength(1);});
