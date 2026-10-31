import { expect, it, vi } from 'vitest';
vi.mock('../satuan', () => ({ loadUnitOptions: async () => new Map() }));
vi.mock('../retur', async original => ({ ...await original<typeof import('../retur')>(), infoBarangRetur: async () => new Map() }));
import { loadSaleReturnRows } from '../return-source-units';
const sources=[
 {id:'pool',item_id:'sku',nama:'Pool',qty:2,faktor:1,harga:20000},
 {id:'other',item_id:'other',nama:'Other',qty:1,faktor:1,harga:100000},
];
function db(snapshots:unknown[],error:unknown=null) {
 return {from:(table:string)=>{
  const q={select:()=>q,is:()=>q,eq:()=>q,in:()=>q,order:()=>q,range:()=>q,
   then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:table==='sale_line_pricing'?snapshots:[],error:table==='sale_line_pricing'?error:null}).then(resolve)};
  return q;
 }};
}
it('loads stored pricing and does not apply the historical global ratio a second time',async()=>{
 const rows=await loadSaleReturnRows(db([{sale_item_id:'pool',version:1,net_paid:38000},{sale_item_id:'other',version:1,net_paid:100000}]),{id:'sale',subtotal:140000,total:138000,payment_plan:[],sale_items:sources});
 expect(rows.map(r=>r.harga)).toEqual([19000,100000]);
});
it('preserves the historical fallback when no new-version pricing exists',async()=>{
 const rows=await loadSaleReturnRows(db([]),{id:'sale',subtotal:140000,total:138000,payment_plan:[],sale_items:sources});
 expect(rows.map(r=>r.harga)).toEqual([20000*(138000/140000),100000*(138000/140000)]);
});
it('fails closed on partial or unreadable pricing snapshots',async()=>{
 const sale={id:'sale',subtotal:140000,total:138000,payment_plan:[],sale_items:sources};
 await expect(loadSaleReturnRows(db([{sale_item_id:'pool',version:1,net_paid:38000}]),sale)).rejects.toThrow(/snapshot/i);
 await expect(loadSaleReturnRows(db([],Error('unavailable')),sale)).rejects.toThrow(/snapshot/i);
});
