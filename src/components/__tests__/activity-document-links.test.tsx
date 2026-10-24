import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
const focused=vi.hoisted(()=>({enabled:false,lookups:0}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams()}));
vi.mock('next/cache',()=>({revalidatePath:()=>{}}));
vi.mock('@/lib/master-guard',()=>({bolehTransaksiKas:async()=>false,bolehKelolaMaster:async()=>false}));
vi.mock('@/app/(app)/pembelian/uang-muka/actions',()=>({bayarUangMuka:async()=>{},batalkanUangMuka:async()=>{},periksaUangMuka:async()=>{}}));
vi.mock('@/app/(app)/penjualan/uang-muka/actions',()=>({batalkanUangMukaJual:async()=>{},terimaUangMukaJual:async()=>{}}));
vi.mock('@/app/(app)/pembelian/perintah-bayar/actions',()=>({batalkanPerintahBayar:async()=>{},bayarPerintahBayar:async()=>{},buatPerintahBayar:async()=>{},setujuiPerintahBayar:async()=>{}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'actor'}}})},from:(table:string)=>{
 const rows=table==='purchase_advances'||table==='sales_advances'?[{id:'advance-id',no_um:'UM-1',tanggal:'2026-10-22',jumlah:100,terpakai:0,status:'aktif'}]
 :table==='payment_orders'?[{id:'order-id',no_pp:'PP-1',tanggal:'2026-10-22',total:100,status:'draft',revision:0,payment_order_items:[]}]:[];
 const q={select:()=>q,eq:()=>{if(table==='payment_orders')focused.lookups++;return q;},in:()=>q,is:()=>q,order:()=>q,limit:()=>q,range:()=>q,maybeSingle:async()=>({data:{id:'10000000-0000-4000-8000-000000000001',no_pp:'PP-OLD',tanggal:'2026-10-01',total:100,status:'draft',revision:0,payment_order_items:[]},error:null}),then:(resolve:(value:unknown)=>void)=>resolve({data:table==='payment_orders'&&focused.enabled?[]:rows,count:rows.length,error:null})};return q;
}})}));
import PurchaseAdvances from '@/app/(app)/pembelian/uang-muka/page';
import SalesAdvances from '@/app/(app)/penjualan/uang-muka/page';
import PaymentOrders from '@/app/(app)/pembelian/perintah-bayar/page';
import { ActivityNavigationProvider } from '../ActivityHistoryLink';
it.each([
 ['purchase advances',PurchaseAdvances,'purchase_advances','advance-id'],
 ['sales advances',SalesAdvances,'sales_advances','advance-id'],
 ['payment orders',PaymentOrders,'payment_orders','order-id'],
] as const)('links an actual %s row to its own history and obeys existing navigation access',async(_name,Page,entity,id)=>{
 const page=await Page({searchParams:Promise.resolve({})});
 const allowed=renderToStaticMarkup(<ActivityNavigationProvider allowed>{page}</ActivityNavigationProvider>);
 expect(allowed).toContain(`entity=${entity}&amp;object=${id}`);
 const denied=renderToStaticMarkup(<ActivityNavigationProvider allowed={false}>{page}</ActivityNavigationProvider>);
 expect(denied).not.toContain('Riwayat aktivitas');
});
it('renders an older selected payment order even when the newest list omits it',async()=>{
 focused.enabled=true;focused.lookups=0;
 try{
  const page=await PaymentOrders({searchParams:Promise.resolve({order:'10000000-0000-4000-8000-000000000001'})});
  const html=renderToStaticMarkup(<ActivityNavigationProvider allowed>{page}</ActivityNavigationProvider>);
  expect(html).toContain('id="payment-order-10000000-0000-4000-8000-000000000001"');
  expect(html).toContain('PP-OLD');
  expect(focused.lookups).toBe(1);
 }finally{focused.enabled=false;}
});
