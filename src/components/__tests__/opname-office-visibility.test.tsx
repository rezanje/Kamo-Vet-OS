import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const s = vi.hoisted(() => ({ orders: [] as Record<string, unknown>[], items: [] as Record<string, unknown>[], failure: '', result: null as Record<string, unknown> | null, allowed: ['wh'], reads: [] as unknown[][], countMissing: false }));
vi.mock('@/lib/opname-cancellation', () => ({ opnameWarehouseIds: async () => s.allowed }));
vi.mock('@/components/StockCorrectionPanel', () => ({ StockCorrectionPanel: () => null }));
vi.mock('@/app/(app)/pos/koreksi-stok/StockCorrectionPanel', () => ({ StockCorrectionPanel: () => null }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) },
  rpc: async () => ({ data: {}, error: null }),
  from(table: string) {
    let start = 0, end = Infinity, single = false;
    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
    const q = {
      select: () => q, order: () => q,
      in: (col: string, values: string[]) => { s.reads.push([table, col, values]); filters.push(r => values.includes(String(r[col]))); return q; },
      eq: (col: string, value: unknown) => { filters.push(r => r[col] === value); return q; },
      neq: (col: string, value: unknown) => { filters.push(r => r[col] !== value); return q; },
      limit: (n: number) => { end = n - 1; return q; },
      range: (from: number, to: number) => { start = from; end = to; return q; },
      maybeSingle: () => { single = true; return q; },
      then(resolve: (v: unknown) => unknown) {
        const rows = (table === 'opname_orders' ? s.orders : table === 'opname_result_items' ? s.items : []).filter(r => filters.every(f => f(r)));
        return Promise.resolve({ data: single ? s.result : rows.slice(start, end + 1), error: s.failure === table ? { message: 'Synthetic read failure' } : null, count: s.countMissing ? null : rows.length }).then(resolve);
      },
    };
    return q;
  },
}) }));
import Page from '@/app/(app)/pos/opname/page';
import { HasilView } from '@/app/(app)/pos/opname/[id]/HasilView';
const render = async (params: Record<string, string> = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
beforeEach(() => {
  s.orders = Array.from({ length: 251 }, (_, i) => ({ id: `order-${i}`, warehouse_id: 'wh', no_opname: `SO-${i}`, tanggal_mulai: '2026-10-23', status: 'Selesai', penanggung_jawab: 'Fictional counter', warehouses: { name: 'Fictional warehouse' }, opname_results: [{ no_hasil: `RESULT-${i}` }], opname_order_items: [] }));
  s.orders.push({ ...s.orders[0], id: 'denied', warehouse_id: 'other', no_opname: 'INACCESSIBLE' });
  s.failure = ''; s.result = null; s.items = []; s.reads = []; s.allowed = ['wh']; s.countMissing = false;
});
it('finds older cashier orders beyond the former 200-row cutoff and links their result', async () => {
  const html = await render({ hal: '5', status: 'Selesai' });
  expect(html).toContain('SO-200'); expect(html).toContain('RESULT-200');
  expect(html).toContain('/pos/opname/order-200#hasil');
  expect(html).toContain('201–250 dari 251'); expect(html).toContain('status=Selesai&amp;hal=6');
  expect(html).not.toContain('INACCESSIBLE');
});
it('distinguishes read failure from an empty history', async () => {
  s.failure = 'opname_orders'; const html = await render();
  expect(html).toContain('role="alert"'); expect(html).not.toContain('Belum ada perintah'); expect(html).not.toContain('SO-0');
});
it('rejects unverifiable counts instead of reporting partial history', async () => {
  s.countMissing = true; expect(await render()).toContain('jumlah data tidak dapat diverifikasi');
});
it('retains cancelled history filter and its paging without widening branch scope', async () => {
  s.orders.forEach(r => { r.status = 'Batal'; });
  const html = await render({ status: 'Batal', hal: '2' });
  expect(html).toContain('SO-50'); expect(html).toContain('status=Batal&amp;hal=3');
  expect(s.reads).toContainEqual(['opname_orders', 'warehouse_id', ['wh']]);
});
it('does not invent completed stock adjustment when the result is absent', async () => {
  const html = renderToStaticMarkup(await HasilView({ orderId: 'order-0' }));
  expect(html).toContain('role="alert"'); expect(html).not.toContain('Stok sudah disesuaikan');
});
it('does not claim success when result metadata fails to load', async () => {
  s.failure = 'opname_results';
  const html = renderToStaticMarkup(await HasilView({ orderId: 'order-0' }));
  expect(html).toContain('role="alert"'); expect(html).not.toContain('Stok sudah disesuaikan');
});
it('loads all result lines beyond the nested relation API limit', async () => {
  s.result = { id: 'result', no_hasil: 'RESULT', opname_result_items: [] };
  s.items = Array.from({ length: 1001 }, (_, i) => ({ id: `line-${i}`, result_id: 'result', item_id: `item-${i}`, qty_sistem: 2, qty_fisik: 1, selisih: -1, items: { code: `CODE-${i}`, name: `Fictional ${i}`, unit: 'PCS' } }));
  const html = renderToStaticMarkup(await HasilView({ orderId: 'order-0' }));
  expect(html).toContain('1001 barang dihitung'); expect(html).toContain('CODE-1000');
});
it('does not display partial results as success after a line query failure', async () => {
  s.result = { id: 'result', no_hasil: 'RESULT', opname_result_items: [] }; s.failure = 'opname_result_items';
  const html = renderToStaticMarkup(await HasilView({ orderId: 'order-0' }));
  expect(html).toContain('role="alert"'); expect(html).not.toContain('Stok sudah disesuaikan');
});
