import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const s = vi.hoisted(() => ({ linked: true, failed: false, signedIn: true }));
vi.mock('@/components/returns/ReturnRecordDetail', () => ({ ReturnRecordDetail: () => <div>Existing return content</div> }));
vi.mock('next/navigation', () => ({ notFound: () => { throw Error('NOT_FOUND'); } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: s.signedIn ? { id: 'actor' } : null } }) },
  from: (table: string) => { const q = { select: () => q, eq: () => q, maybeSingle: () => q,
    then(resolve: (r: unknown) => unknown) { return Promise.resolve({ data: table === 'purchase_returns' ? { id: '10000000-0000-4000-8000-000000000001', po_id: s.linked ? '20000000-0000-4000-8000-000000000002' : null, no_retur: 'RET-FICTIONAL', total: 0, revision: 0 } : table === 'purchase_return_items' ? [] : table === 'profiles' ? { role: 'STAFF', is_active: true } : null, error: s.failed ? { message: 'Synthetic read failure' } : null }).then(resolve); }
  }; return q; },
}) }));
import Page from '@/app/(app)/pembelian/retur/[id]/page';
const id = '10000000-0000-4000-8000-000000000001';
const origin = '/pembelian/20000000-0000-4000-8000-000000000002';
beforeEach(() => { s.linked = true; s.failed = false; s.signedIn = true; });
it('retains the exact PO return context supplied by related-document navigation', async () => {
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ from: origin }) }));
  expect(html).toContain('Kembali ke transaksi asal'); expect(html).toContain(`href="${origin}"`);
});
it('does not render an external or executable return target', async () => {
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ from: 'https://untrusted.invalid' }) }));
  expect(html).not.toContain('https://untrusted.invalid');
});

const realDetail = () => vi.importActual<typeof import('@/components/returns/ReturnRecordDetail')>('@/components/returns/ReturnRecordDetail');
it('links only the stored PO identity and keeps an exact return context', async () => {
  const { ReturnRecordDetail } = await realDetail();
  const html = renderToStaticMarkup(await ReturnRecordDetail({ kind: 'purchase', id }));
  const href = html.match(/href="([^"]+)"[^>]*>Pesanan pembelian asal/)!;
  expect(href).not.toBeNull();
  const url = new URL(href[1].replaceAll('&amp;', '&'), 'http://localhost');
  expect(url.pathname).toBe(origin); expect(url.searchParams.get('from')).toBe('/pembelian/retur/'+id);
});
it('does not guess a missing PO from a document number', async () => {
  s.linked = false; const { ReturnRecordDetail } = await realDetail();
  const html = renderToStaticMarkup(await ReturnRecordDetail({ kind: 'purchase', id }));
  expect(html).not.toContain('Pesanan pembelian asal');
});
it('retains signed-in and failed-source guards', async () => {
  const { ReturnRecordDetail } = await realDetail(); s.signedIn = false;
  await expect(ReturnRecordDetail({ kind: 'purchase', id })).rejects.toThrow('NOT_FOUND');
  s.signedIn = true; s.failed = true;
  await expect(ReturnRecordDetail({ kind: 'purchase', id })).rejects.toThrow('belum dapat dimuat');
});
