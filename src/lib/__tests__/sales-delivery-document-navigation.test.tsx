import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

const state=vi.hoisted(()=>({id:'10000000-0000-4000-8000-000000000001',lookups:0,includeInList:false}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({from:()=>{
 const row={id:state.id,no_kirim:'DO.2026.10.00001',tanggal:'2026-10-24',ekspedisi:null,no_resi:null,sales_orders:null,sales_delivery_items:[]};
 const q={select:()=>q,order:()=>q,limit:()=>q,eq:()=>{state.lookups++;return q;},maybeSingle:async()=>({data:row,error:null}),then:(resolve:(result:unknown)=>void)=>resolve({data:state.includeInList?[row]:[],error:null})};return q;
}})}));
import DeliveryPage from '@/app/(app)/penjualan/pengiriman/page';

it('loads an older numbered delivery omitted by the newest 200 rows',async()=>{
 state.includeInList=false;state.lookups=0;
 const html=renderToStaticMarkup(await DeliveryPage({searchParams:Promise.resolve({delivery:state.id})}));
 expect(state.lookups).toBe(1);
 expect(html).toContain(`id="delivery-${state.id}"`);
 expect(html).toContain('DO.2026.10.00001');
 expect(state.lookups).toBe(1);
});
it('does not refetch a delivery already present in the list',async()=>{
 state.includeInList=true;state.lookups=0;
 const html=renderToStaticMarkup(await DeliveryPage({searchParams:Promise.resolve({delivery:state.id})}));
 expect(html.match(/DO.2026.10.00001/g)).toHaveLength(1);
 expect(state.lookups).toBe(0);
});
