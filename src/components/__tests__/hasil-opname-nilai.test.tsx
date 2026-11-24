import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const s = vi.hoisted(() => ({ report: null as unknown, rpcError: false, throws: false, effective: null as unknown }));
vi.mock('@/components/StockCorrectionPanel', () => ({ StockCorrectionPanel: () => null }));
vi.mock('@/app/(app)/pos/koreksi-stok/StockCorrectionPanel', () => ({ StockCorrectionPanel: () => null }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  rpc: async (name: string) => {
    if (name === 'read_stock_document_effective') return { data: s.effective, error: null };
    if (s.throws) throw Error('boom');
    return s.rpcError ? { data: null, error: { message: 'denied' } } : { data: s.report, error: null };
  },
  from(table: string) {
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, range: () => q, maybeSingle: () => q,
      then(resolve: (v: unknown) => unknown) {
        const data = table === 'opname_results' ? { id: 'res-1', no_hasil: 'OPR.1', tanggal: '2026-11-24', sales_invoices: null }
          : [{ id: 'r1', item_id: 'i1', qty_sistem: 10, qty_fisik: 13, selisih: 3, items: { code: 'A', name: 'Barang A', unit: 'PCS' } },
             { id: 'r2', item_id: 'i2', qty_sistem: 5, qty_fisik: 0, selisih: -5, items: { code: 'B', name: 'Barang B', unit: 'PCS' } }];
        return Promise.resolve({ data, count: Array.isArray(data) ? data.length : 1, error: null }).then(resolve);
      } };
    return q;
  },
}) }));
import { HasilView } from '@/app/(app)/pos/opname/[id]/HasilView';
const report = { version: 1, rows: [{ selisih: 3, nilai_selisih_modal: '300', name: 'Barang A' }, { selisih: -5, nilai_selisih_modal: '-500', name: 'Barang B' }] };
beforeEach(() => { s.report = report; s.rpcError = false; s.throws = false; s.effective = null; });
it('office view shows shortage, surplus and net value from the posting snapshot', async () => {
  const html = renderToStaticMarkup(await HasilView({ orderId: 'o1', allowCorrections: true }));
  expect(html).toContain('data-nilai-opname'); expect(html).toContain('kurang Rp 500'); expect(html).toContain('lebih Rp 300'); expect(html).toContain('neto kurang Rp 200');
});
it('cashier view (no allowCorrections) never reads or shows modal value', async () => {
  const html = renderToStaticMarkup(await HasilView({ orderId: 'o1' }));
  expect(html).not.toContain('data-nilai-opname'); expect(html).not.toContain('Rp 500');
});
it('a role without report permission (rpc refused or throwing) simply sees no banner', async () => {
  s.rpcError = true; let html = renderToStaticMarkup(await HasilView({ orderId: 'o1', allowCorrections: true }));
  expect(html).not.toContain('data-nilai-opname'); expect(html).toContain('Barang A');
  s.rpcError = false; s.throws = true; html = renderToStaticMarkup(await HasilView({ orderId: 'o1', allowCorrections: true }));
  expect(html).not.toContain('data-nilai-opname'); expect(html).toContain('Barang B');
});
it('legacy surplus rows valued at Rp 0 raise the unpriced warning', async () => {
  s.report = { version: 1, rows: [{ selisih: 17, nilai_selisih_modal: '0', name: 'ANC Can Adult 400g' }] };
  const html = renderToStaticMarkup(await HasilView({ orderId: 'o1', allowCorrections: true }));
  expect(html).toContain('belum punya harga sama sekali'); expect(html).toContain('ANC Can Adult 400g');
});
it('after a correction the banner is hidden (the snapshot is the original document)', async () => {
  s.effective = { 'res-1': { revision: 1, rows: [{ item_id: 'i1', qty: 14, selisih: 4 }] } };
  const html = renderToStaticMarkup(await HasilView({ orderId: 'o1', allowCorrections: true }));
  expect(html).not.toContain('data-nilai-opname'); expect(html).toContain('Hasil efektif setelah koreksi');
});
