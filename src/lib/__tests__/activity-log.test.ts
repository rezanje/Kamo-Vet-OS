import { describe, expect, it } from 'vitest';
import { activityFilters, activityHref, ACTIVITY_PAGE_SIZE, activityObjectHref } from '../activity-log';

describe('activity viewer navigation', () => {
 it('accepts only registered entities, actions and bounded cursor identities', () => {
  expect(activityFilters({entity:'profiles',action:'drop',before:'-1',q:'x'.repeat(200)})).toMatchObject({entity:'',action:'',before:'',q:'x'.repeat(120)});
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

it('finds the matching menu without promising history for unsupported menus', async () => {
 const { activityMenuHref } = await import('../activity-log');
 expect(activityMenuHref('/pos/sku')).toBe('/perusahaan/log-aktifitas?entity=items');
 expect(activityMenuHref('/pembelian/faktur/example')).toBe('/perusahaan/log-aktifitas?entity=purchase_invoices');
 expect(activityMenuHref('/hris/penggajian')).toBeNull();
 expect(activityMenuHref('/klinik/rekam-medis')).toBeNull();
});
