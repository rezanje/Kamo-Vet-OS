import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const s = vi.hoisted(() => ({ partial: true, failed: false, status: 'Terbuka' }));
vi.mock('next/navigation', () => ({ notFound: () => { throw Error('NOT_FOUND'); }, redirect: (url: string) => { throw Error(url); } }));
vi.mock('@/lib/opname-cancellation', () => ({ opnameWarehouseIds: async () => ['wh'], opnameCancellationBlock: async () => 'Existing source needs review' }));
vi.mock('@/lib/shift', () => ({ getOpenShift: async () => ({ branch_id: 'branch' }) }));
vi.mock('@/app/kasir/opname/gudang', () => ({ gudangCabang: async () => ({ id: 'wh', name: 'Fictional warehouse' }) }));
vi.mock('@/app/kasir/opname/[id]/DaftarHitung', () => ({ DaftarHitung: () => <div>COUNT FORM</div> }));
vi.mock('@/app/(app)/pos/opname/[id]/HasilView', () => ({ HasilView: () => <div>SOURCE RESULT</div> }));
vi.mock('@/components/OpnameCancellationPanel', () => ({ OpnameCancellationPanel: () => null }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) },
  from(table: string) { const q = { select: () => q, eq: () => q, in: () => q, maybeSingle: () => q,
    then(resolve: (r: unknown) => unknown) { return Promise.resolve({ data: table === 'opname_orders' ? { id: 'order', no_opname: 'OPO.FICTIONAL', status: s.status, warehouse_id: 'wh', tanggal_mulai: '2026-10-23', penanggung_jawab: 'Fictional counter', warehouses: { name: 'Fictional warehouse' } } : [], count: table === 'opname_results' && s.partial ? 1 : 0, error: table === 'opname_results' && s.failed ? { message: 'Synthetic unavailable source' } : null }).then(resolve); },
  }; return q; },
}) }));
import Office from '@/app/(app)/pos/opname/[id]/page';
import Cashier from '@/app/kasir/opname/[id]/page';
const props = () => ({ params: Promise.resolve({ id: 'order' }), searchParams: Promise.resolve({}) });
beforeEach(() => { s.partial = true; s.failed = false; s.status = 'Terbuka'; });
it('shows an existing partial result in office without claiming it is uncounted or fully posted', async () => {
  const html = renderToStaticMarkup(await Office(props()));
  expect(html).toContain('SOURCE RESULT'); expect(html).toContain('posting ulang'); expect(html).not.toContain('HITUNGAN BELUM MASUK');
});
it('hides the cashier posting form when an earlier result already exists', async () => {
  const html = renderToStaticMarkup(await Cashier(props()));
  expect(html).toContain('SOURCE RESULT'); expect(html).toContain('posting ulang'); expect(html).not.toContain('COUNT FORM');
});
it('does not treat a failed source-presence check as permission to post again', async () => {
  s.failed = true; const html = renderToStaticMarkup(await Cashier(props()));
  expect(html).toContain('role="alert"'); expect(html).not.toContain('COUNT FORM');
});
it('keeps normal counting available for a verified empty open order', async () => {
  s.partial = false; const html = renderToStaticMarkup(await Cashier(props())); expect(html).toContain('COUNT FORM'); expect(html).not.toContain('SOURCE RESULT');
});
