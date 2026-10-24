import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
const source='20000000-0000-4000-8000-000000000002';
vi.mock('@/lib/return-source-units',()=>({loadSaleReturnRows:async()=>[]}));
vi.mock('@/lib/shift',()=>({getOpenShift:async()=>({branch_id:'branch',branchName:'Fictional branch'})}));
vi.mock('@/app/(app)/penjualan/retur/actions',()=>({recoverReturJual:vi.fn(),buatReturJual:vi.fn()}));
vi.mock('@/components/PostingRequestIdentity',()=>({PostingRequestIdentity:()=> <input type="hidden" name="request_key" value="fictional-recovery"/>}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({
 auth:{getUser:async()=>({data:{user:{id:'actor'}}})},
 from:(table:string)=>{const q={select:()=>q,eq:()=>q,is:()=>q,order:()=>q,limit:()=>q,maybeSingle:()=>q,
 then(resolve:(v:unknown)=>unknown){return Promise.resolve({data:table==='sales'?{id:source,no_struk:'FICT-SOURCE',branch_id:'branch',subtotal:100,total:100,sale_items:[]}:[],error:null}).then(resolve);}};return q;}
})}));
import Office from '@/app/(app)/penjualan/retur/baru/page';
import Cashier from '@/app/kasir/retur/page';
it.each([Office,Cashier])('fully returned source keeps exact identity in receipt-only recovery form',async Page=>{
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({struk:'FICT-SOURCE'})}));
 const form=html.match(/<form>([\s\S]*?)<\/form>/)?.[1];
 expect(form).toBeDefined();
 expect(form).toContain(`name="sale_id" value="${source}"`);
 expect(form).toContain('name="request_key" value="fictional-recovery"');
});
