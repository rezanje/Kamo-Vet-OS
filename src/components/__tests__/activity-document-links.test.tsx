import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('next/cache',()=>({revalidatePath:()=>{}}));
vi.mock('@/lib/master-guard',()=>({bolehTransaksiKas:async()=>false,bolehKelolaMaster:async()=>false}));
vi.mock('@/app/(app)/pembelian/uang-muka/actions',()=>({bayarUangMuka:async()=>{},batalkanUangMuka:async()=>{}}));
vi.mock('@/app/(app)/penjualan/uang-muka/actions',()=>({batalkanUangMukaJual:async()=>{},terimaUangMukaJual:async()=>{}}));
vi.mock('@/app/(app)/pembelian/perintah-bayar/actions',()=>({batalkanPerintahBayar:async()=>{},bayarPerintahBayar:async()=>{},buatPerintahBayar:async()=>{},setujuiPerintahBayar:async()=>{}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'actor'}}})},from:(table:string)=>{
 const rows=table==='purchase_advances'||table==='sales_advances'?[{id:'advance-id',no_um:'UM-1',tanggal:'2026-10-22',jumlah:100,terpakai:0,status:'aktif'}]
 :table==='payment_orders'?[{id:'order-id',no_pp:'PP-1',tanggal:'2026-10-22',total:100,status:'draft',revision:0,payment_order_items:[]}]:[];
 const q={select:()=>q,eq:()=>q,in:()=>q,is:()=>q,order:()=>q,limit:()=>q,then:(resolve:(value:unknown)=>void)=>resolve({data:rows,error:null})};return q;
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
