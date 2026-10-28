import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { activityFilters, activityHref, ACTIVITY_ENTITIES, ACTIVITY_MODULES, ACTIVITY_PAGE_SIZE, activityObjectHref, activityMenuHref, activityRouteObject } from '../activity-log';

describe('activity viewer navigation', () => {
 it('accepts only registered entities, actions and bounded cursor identities', () => {
  expect(activityFilters({entity:'activity_log',action:'drop',before:'-1',q:'x'.repeat(200)})).toMatchObject({entity:'',action:'',before:'',q:'x'.repeat(120)});
  expect(activityFilters({entity:'sales_orders',object:'abc',action:'delete',before:'9223372036854775808'})).toMatchObject({entity:'sales_orders',object:'abc',action:'delete',before:''});
  expect(ACTIVITY_PAGE_SIZE).toBe(40);
 });
 it('preserves object, module, search, date and action filters across pagination', () => {
  const filters=activityFilters({entity:'sales_orders',object:'a&b',module:'penjualan',action:'delete',from:'2026-10-22',to:'2026-10-23',q:'SO & 1',before:'81'});
  const url=new URL(activityHref(filters,{before:'41',after:''}),'https://example.test');
  expect(Object.fromEntries(url.searchParams)).toEqual({entity:'sales_orders',object:'a&b',module:'penjualan',action:'delete',from:'2026-10-22',to:'2026-10-23',q:'SO & 1',before:'41'});
 });
 it('rejects malformed/rolled-over dates, orphan object filters and conflicting cursors', () => {
  expect(activityFilters({object:'hidden',from:'2026-02-30',to:'not-date',before:'20',after:'40'})).toMatchObject({object:'',from:'',to:'',before:'20',after:''});
 });
 it('links an object to history without requiring the object to still exist', () => {
  expect(activityObjectHref('customers','deleted/id')).toBe('/perusahaan/log-aktifitas?entity=customers&object=deleted%2Fid');
 });
});

it('matches every explicitly registered source and module with localized labels', () => {
 const files=['20261022070000_activity_audit.sql','20261022081000_activity_audit_financial.sql','20261022082000_activity_audit_inventory.sql','20261022083000_activity_audit_people_settings.sql','20261022084000_activity_audit_remaining_modules.sql','20261023193000_sales_refund_payout.sql','20261027153000_purchase_correction_requests.sql','20261028110100_clinic_patient_history_rpc.sql','20261028140000_j03_clinic_refund.sql','20261030111000_a01_activity_audit_new_sources.sql'];
 const sources=files.flatMap(file=>[...readFileSync(`supabase/migrations/${file}`,'utf8').matchAll(/(?:^\s*|values\s*)\('([^']+)'\s*,\s*'([^']+)'/gm)].map(match=>({entity:match[1],module:match[2]})));
 expect(sources.length).toBe(201);
 expect(Object.keys(ACTIVITY_ENTITIES).sort()).toEqual(sources.map(s=>s.entity).sort());
 for(const source of sources){expect(ACTIVITY_ENTITIES[source.entity]).not.toContain('_');expect(ACTIVITY_MODULES[source.module]).toBeTruthy();}
});

it('preserves composite object identities and rejects unsafe or oversized identities without truncating them',()=>{
 const object=JSON.stringify({close_id:'a'.repeat(36),warehouse_id:'b'.repeat(36),item_id:'c'.repeat(36)});
 expect(object.length).toBeGreaterThan(120);
 expect(activityFilters({entity:'inventory_month_values',object}).object).toBe(object);
 expect(new URL(activityObjectHref('inventory_month_values',object),'https://example.test').searchParams.get('object')).toBe(object);
 expect(activityFilters({entity:'items',object:'x'.repeat(4097)}).object).toBe('');
 expect(activityFilters({entity:'items',object:'bad\u0000id'}).object).toBe('');
});

it('finds the matching menu without promising history for unsupported menus', async () => {
 expect(activityMenuHref('/pos/sku')).toBe('/perusahaan/log-aktifitas?entity=items');
 expect(activityMenuHref('/pembelian/faktur/example')).toBe('/perusahaan/log-aktifitas?entity=purchase_invoices');
 expect(activityMenuHref('/hris/penggajian')).toBe('/perusahaan/log-aktifitas?entity=payrolls');
 expect(activityMenuHref('/klinik/rekam-medis')).toBe('/perusahaan/log-aktifitas?entity=medical_records');
 expect(activityMenuHref('/laporan/penjualan-barang')).toBeNull();
});

it.each([
 ['/pembelian/uang-muka','purchase_advances'],['/penjualan/uang-muka','sales_advances'],
 ['/pembelian/perintah-bayar','payment_orders'],['/keuangan/hutang','purchase_invoice_payments'],
 ['/penjualan/retur/example','sales_returns'],['/pembelian/retur/example','purchase_returns'],
 ['/pos/sku/varian','item_variant_families'],['/pos/sku/impor','import_runs'],
 ['/pengaturan/akses-grup','role_modules'],['/perusahaan/gudang','warehouses'],
 ['/crm/kampanye','campaign_codes'],['/keuangan/saldo-awal-faktur','opening_invoice_batches'],
])('routes the registered menu %s to %s',(path,entity)=>{expect(activityMenuHref(path)).toBe(`/perusahaan/log-aktifitas?entity=${entity}`);});

it.each([
 ['/pembelian/penerimaan/receipt-id','goods_receipts','receipt-id'],
 ['/penjualan/retur/return-id','sales_returns','return-id'],
 ['/pembelian/retur/return-id','purchase_returns','return-id'],
 ['/pos/struk/sale-id','sales','sale-id'],
 ['/klinik/penerimaan/terima/request-id','stock_requests','request-id'],
 ['/klinik/rawat-inap/inpatient-id/catatan','inpatient_records','inpatient-id'],
 ['/hris/karyawan/employee-id','employees','employee-id'],
 ['/keuangan/jurnal-berulang/schedule-id','recurring_journals','schedule-id'],
])('finds the actual stable object for %s',(path,entity,id)=>{expect(activityRouteObject(path)).toEqual({entity,id});});
it('does not mistake static creation/import screens for object identities',()=>{
 for(const path of ['/pembelian/retur/baru','/hris/karyawan/impor','/pos/permintaan/baru','/klinik/rekam-medis/impor'])expect(activityRouteObject(path)).toBeNull();
});
