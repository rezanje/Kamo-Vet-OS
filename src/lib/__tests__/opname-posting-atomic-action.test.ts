import { beforeEach, expect, it, vi } from 'vitest';
const s = vi.hoisted(() => ({ stock: 0, results: 0, journals: 0, rpcCalls: [] as unknown[], failure: true, paths: [] as string[], responseMode: '' }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw Error(decodeURIComponent(url)); } }));
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => s.paths.push(path) }));
vi.mock('@/lib/inventory', () => ({ stockInAtBuyPrice: async () => { s.stock += 1; } }));
vi.mock('@/lib/no-dokumen', () => ({ nomorBerikutnya: async () => ({ nomor: 'OPR.FICTION' }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) },
  rpc: async (name: string, params: unknown) => { s.rpcCalls.push({ name, params }); if (s.responseMode === 'transport') throw Error('Synthetic private transport detail'); if (s.responseMode === 'empty') return { data: null, error: null }; return s.failure ? { data: null, error: { code: 'P0001', message: 'Fictional journal failure' } } : { data: { result_id: '30000000-0000-4000-8000-000000000003', no_hasil: 'OPR.FICTION', tanggal: '2026-10-23', no_faktur: null, already_posted: false, journal_ids: ['40000000-0000-4000-8000-000000000004'] }, error: null }; },
  from(table: string) {
    let op = 'read'; const q = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q, maybeSingle: () => q, single: () => q,
      insert: () => { op = 'insert'; return q; }, update: () => { op = 'update'; return q; }, delete: () => q,
      then(resolve: (r: unknown) => unknown) {
        if (table === 'opname_results' && op === 'insert') s.results++;
        const data = table === 'accounting_locks' ? { closed_until: null } : table === 'opname_orders' ? { id: '10000000-0000-4000-8000-000000000001', no_opname: 'OPO.FICTION', status: 'Terbuka', warehouse_id: 'wh', warehouses: { branch_id: 'branch', type: 'VET', branches: { type: 'KLINIK' } } } : table === 'profiles' ? { role: 'OWNER' } : table === 'opname_counts' ? [{ item_id: '20000000-0000-4000-8000-000000000002', qty_fisik: 1, qty_sistem: 0 }] : table === 'opname_results' ? { id: '30000000-0000-4000-8000-000000000003' } : table === 'items' ? [{ id: '20000000-0000-4000-8000-000000000002', name: 'Fictional goods', unit: 'PCS', buy_price: 100 }] : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    }; return q;
  },
}) }));
import { simpanHasil } from '@/app/(app)/pos/opname/actions';
const form = () => { const f = new FormData(); f.set('order_id', '10000000-0000-4000-8000-000000000001'); f.set('tanggal', '2026-10-23'); f.set('fisik', JSON.stringify({ '20000000-0000-4000-8000-000000000002': 1 })); f.set('kembali', 'kasir'); return f; };
beforeEach(() => { s.stock = 0; s.results = 0; s.journals = 0; s.rpcCalls = []; s.failure = true; s.paths = []; s.responseMode = ''; });
it('cannot leave stock or a result behind when journal posting fails', async () => {
  await expect(simpanHasil(form())).rejects.toThrow();
  expect(s.stock).toBe(0); expect(s.results).toBe(0); expect(s.journals).toBe(0);
});
it('posts through one server transaction and confirms the returned receipt before success', async () => {
  s.failure = false; await expect(simpanHasil(form())).rejects.toThrow('success=');
  expect(s.rpcCalls).toEqual([{ name: 'post_opname_atomic', params: { p_order_id: '10000000-0000-4000-8000-000000000001', p_tanggal: '2026-10-23', p_counts: { '20000000-0000-4000-8000-000000000002': 1 } } }]);
});

it('does not retire a draft or claim success for an empty transaction response', async () => {
 s.failure = false; s.responseMode = 'empty'; const f = form(); f.set('draft_key','saved-key'); f.set('draft_scope','opname-count');
 await expect(simpanHasil(f)).rejects.toThrow('belum dapat dipastikan'); expect(s.paths).toEqual([]);
});
it('reports a lost response as uncertain without leaking transport details or retrying', async () => {
 s.failure = false; s.responseMode = 'transport';
 await expect(simpanHasil(form())).rejects.toThrow('belum dapat dipastikan'); expect(s.rpcCalls).toHaveLength(1); expect(s.paths).toEqual([]);
});
it('rejects a malformed physical-count payload before posting', async () => {
 const f = form(); f.set('fisik','broken-json'); await expect(simpanHasil(f)).rejects.toThrow('Hitungan'); expect(s.rpcCalls).toHaveLength(0);
});
