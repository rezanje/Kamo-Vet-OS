import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const s = vi.hoisted(() => ({ linked: true, failed: false, signedIn: true }));
vi.mock('@/components/returns/ReturnRecordDetail', () => ({ ReturnRecordDetail: () => <div>Existing return content</div> }));
vi.mock('next/navigation', () => ({ notFound: () => { throw Error('NOT_FOUND'); } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
 rpc:async()=>({data:null,error:null}),
 auth: { getUser: async () => ({ data: { user: s.signedIn ? { id: 'actor' } : null } }) },
 from: (table: string) => { const q = { select: () => q, eq: () => q, maybeSingle: () => q,
 then(resolve: (r: unknown) => unknown) { return Promise.resolve({ data: table === 'sales_returns' ? { id: '10000000-0000-4000-8000-000000000001', sale_id: s.linked ? '20000000-0000-4000-8000-000000000002' : null, no_retur: 'RET-FICTIONAL', total: 0, revision: 0 } : table === 'sales_return_items' ? [] : table === 'profiles' ? { role: 'STAFF', is_active: true } : null, error: s.failed ? { message: 'Synthetic private read failure' } : null }).then(resolve); }
 }; return q; },
}) }));
import Page from '@/app/(app)/penjualan/retur/[id]/page';
const id = '10000000-0000-4000-8000-000000000001';
const origin = '/penjualan/20000000-0000-4000-8000-000000000002';
beforeEach(() => { s.linked = true; s.failed = false; s.signedIn = true; });
it('retains the exact retail sale context instead of discarding it', async () => {
 const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ from: origin }) }));
 expect(html).toContain('Kembali ke transaksi asal'); expect(html).toContain(`href="${origin}"`);
});
it.each(['https://untrusted.invalid', '/penjualan/'+id+'?replace=1', '/penjualan/../pengaturan'])('rejects unsafe sales return context %s', async from => {
 const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ from }) }));
 expect(html).not.toContain('Kembali ke transaksi asal');
});
const realDetail = () => vi.importActual<typeof import('@/components/returns/ReturnRecordDetail')>('@/components/returns/ReturnRecordDetail');
it('opens only the stored retail sale, without claiming a wholesale invoice relation', async () => {
 const { ReturnRecordDetail } = await realDetail();
 const html = renderToStaticMarkup(await ReturnRecordDetail({ kind: 'sales', id }));
 expect(html).toContain(`href="${origin}"`); expect(html).toContain('Penjualan asal'); expect(html).not.toContain('/penjualan/faktur/');
});
it('does not guess a missing sale from the return number', async () => {
 s.linked = false; const { ReturnRecordDetail } = await realDetail();
 const html = renderToStaticMarkup(await ReturnRecordDetail({ kind: 'sales', id }));
 expect(html).not.toContain('Penjualan asal');
});
it('preserves authentication and source-read failures', async () => {
 const { ReturnRecordDetail } = await realDetail(); s.signedIn = false;
 await expect(ReturnRecordDetail({ kind: 'sales', id })).rejects.toThrow('NOT_FOUND');
 s.signedIn = true; s.failed = true;
 await expect(ReturnRecordDetail({ kind: 'sales', id })).rejects.toThrow('belum dapat dimuat');
});
