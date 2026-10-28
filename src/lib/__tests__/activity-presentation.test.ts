import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {activityValue,activityFieldLabel,activitySourceLinks,activitySourceKey} from '../activity-presentation';
import type {ActivityRow} from '../activity-log';
import type {SupabaseClient} from '@supabase/supabase-js';

it('preserves full decimal strings, tiny numbers, zero, booleans and missing values',()=>{
 expect(activityValue('harga','12345678901234567890.012345')).toBe('12.345.678.901.234.567.890,012345');
 expect(activityValue('qty',1e-24)).toBe('0,000000000000000000000001');
 expect(activityValue('qty',0)).toBe('0');expect(activityValue('is_active',false)).toBe('Tidak');
 expect(activityValue('qty',null)).toBe('Kosong');expect(activityValue('qty',undefined)).toBe('—');
 expect(activityValue('qty',NaN)).toBe('Nilai disamarkan');
});
it('localizes dates without changing their business day, and hides malformed/nested values',()=>{
 expect(activityValue('tanggal','2026-10-24')).toBe('24 Okt 2026');
 expect(activityValue('paid_at','2026-10-24T03:15:00Z')).toContain('10.15');
 expect(activityValue('paid_at','2026-10-24T03:15:00Z')).toContain('WIB');
 expect(activityValue('tanggal','2026-02-30')).toBe('Nilai disamarkan');
 expect(activityValue('status','draft')).toBe('Draf');
 expect(activityValue('harga',{secret:'private'})).toBe('Nilai disamarkan');
 expect(activityValue('password','private')).toBe('Nilai disamarkan');
 expect(activityFieldLabel('some_new_field')).toBe('Bagian lainnya');
});
it('opens only allowlisted existing routes, never a guessed clinical invoice or child route',async()=>{
 const a='11111111-1111-4111-8111-111111111111';
 const rows=['purchase_orders','goods_receipts','purchase_invoices','purchase_returns','sales_invoices','sales_orders','sales_returns','sales','invoices','purchase_invoice_payments'].map(entity=>({entity,entity_id:a,action:'update'} as ActivityRow));
 const db={from:()=>({select:()=>({in:async()=>({data:[{id:a,channel:null}],error:null})})})} as unknown as SupabaseClient;
 const result=await activitySourceLinks(db,rows,null);
 const paths=['/pembelian/','/pembelian/penerimaan/','/pembelian/faktur/','/pembelian/retur/','/penjualan/faktur/','/penjualan/pesanan/','/penjualan/retur/','/pos/struk/'];
 rows.slice(0,8).forEach((row,index)=>expect(result.links.get(activitySourceKey(row.entity,a))).toBe(paths[index]+a));
 expect(result.links.size).toBe(8);expect(result.unavailable).toBe(false);
});

it('preserves item identifiers exactly instead of interpreting them as numbers or statuses',()=>{
 expect(activityValue('code','123456')).toBe('123456');
 expect(activityValue('code','001234')).toBe('001234');
 expect(activityValue('code','draft')).toBe('draft');
});

it('never links an online sale or missing channel to a retail-only receipt',async()=>{
 const a='11111111-1111-4111-8111-111111111111';
 const rows=[{entity:'sales',entity_id:a,action:'update'} as ActivityRow];
 for(const channel of ['online','marketplace',undefined]){
  const db={from:()=>({select:()=>({in:async()=>({data:[{id:a,channel}],error:null})})})} as unknown as SupabaseClient;
  expect((await activitySourceLinks(db,rows,null)).links.size).toBe(0);
 }
});

it('denies a source moved outside the current branch grant even if its legacy SELECT policy returns it',async()=>{
 const a='11111111-1111-4111-8111-111111111111';
 const db={from:()=>({select:()=>({in:async()=>({data:[{id:a,branch_id:'other-branch'}],error:null})})})} as unknown as SupabaseClient;
 const result=await activitySourceLinks(db,[{entity:'purchase_orders',entity_id:a,action:'update'} as ActivityRow],['allowed-branch']);
 expect(result.links.size).toBe(0);
});

it('checks stored parent branch relationships and fails closed when that relationship is unavailable',async()=>{
 const a='11111111-1111-4111-8111-111111111111';
 let parent:unknown={branch_id:'allowed-branch'};
 const db={from:()=>({select:()=>({in:async()=>({data:[{id:a,purchase_orders:parent}],error:null})})})} as unknown as SupabaseClient;
 const rows=[{entity:'goods_receipts',entity_id:a,action:'update'} as ActivityRow];
 expect((await activitySourceLinks(db,rows,['allowed-branch'])).links.get(activitySourceKey('goods_receipts',a))).toBe('/pembelian/penerimaan/'+a);
 parent={branch_id:'other-branch'};expect((await activitySourceLinks(db,rows,['allowed-branch'])).links.size).toBe(0);
 parent=null;expect((await activitySourceLinks(db,rows,['allowed-branch'])).links.size).toBe(0);
});

it('labels every value captured from the sources registered on 29 Oct',()=>{
 const sql=readFileSync('supabase/migrations/20261029150000_a01_audit_new_tables.sql','utf8');
 const keys=[...sql.matchAll(/^ \('[a-z_]+', '[a-z-]+', (?:'[a-z_]+'|null), array\[([^\]]*)\]/gm)].flatMap(m=>[...m[1].matchAll(/'([a-z_]+)'/g)].map(k=>k[1]));
 expect(keys).toEqual(expect.arrayContaining(['max_uses','doctor_required','ap_total','outstanding','restock','active']));
 for(const key of keys)expect(activityFieldLabel(key)).not.toBe('Bagian lainnya');
 expect(activityValue('restock',true)).toBe('Ya');
 expect(activityValue('outstanding','1500000')).toBe('1.500.000');
});
