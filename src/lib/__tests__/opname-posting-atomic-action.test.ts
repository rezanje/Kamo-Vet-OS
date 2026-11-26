import { beforeEach, expect, it, vi } from 'vitest';
const s = vi.hoisted(() => ({ stock: 0, results: 0, journals: 0, rpcCalls: [] as unknown[], failure: true, failMsg: 'Fictional journal failure', paths: [] as string[], responseMode: '' }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw Error(decodeURIComponent(url)); } }));
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => s.paths.push(path) }));
vi.mock('@/lib/inventory', () => ({ stockInAtBuyPrice: async () => { s.stock += 1; } }));
vi.mock('@/lib/no-dokumen', () => ({ nomorBerikutnya: async () => ({ nomor: 'OPR.FICTION' }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) },
  rpc: async (name: string, params: unknown) => { s.rpcCalls.push({ name, params }); if (s.responseMode === 'transport') throw Error('Synthetic private transport detail'); if (s.responseMode === 'empty') return { data: null, error: null }; if (s.responseMode === 'moved') return { data: { result_id: '30000000-0000-4000-8000-000000000003', no_hasil: 'OPR.FICTION', tanggal: '2026-10-23', no_faktur: null, already_posted: false, journal_ids: [], bergerak_sejak_hitung: 2 }, error: null }; if (s.responseMode === 'values') return { data: { result_id: '30000000-0000-4000-8000-000000000003', no_hasil: 'OPR.FICTION', tanggal: '2026-10-23', no_faktur: null, already_posted: false, journal_ids: ['40000000-0000-4000-8000-000000000004'], shortage_value: 500, surplus_value: 300, surplus_offset: 300, net_variance: 200, surplus_unpriced: [{ item_id: '20000000-0000-4000-8000-000000000002', name: 'Barang Z', qty: 2 }] }, error: null }; return s.failure ? { data: null, error: { code: 'P0001', message: s.failMsg } } : { data: { result_id: '30000000-0000-4000-8000-000000000003', no_hasil: 'OPR.FICTION', tanggal: '2026-10-23', no_faktur: null, already_posted: false, journal_ids: ['40000000-0000-4000-8000-000000000004'] }, error: null }; },
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
beforeEach(() => { s.stock = 0; s.results = 0; s.journals = 0; s.rpcCalls = []; s.failure = true; s.failMsg = 'Fictional journal failure'; s.paths = []; s.responseMode = ''; });
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
it('office success message states shortage, surplus (HPP rata-rata) and net, plus the unpriced warning', async () => {
 s.failure = false; s.responseMode = 'values'; const f = form(); f.set('kembali', 'office');
 await expect(simpanHasil(f)).rejects.toThrow(/success=[\s\S]*Nilai selisih: kurang Rp 500, lebih Rp 300 \(HPP rata-rata[\s\S]*neto kurang Rp 200[\s\S]*1 barang selisih lebih belum punya harga sama sekali[\s\S]*Barang Z/);
});
it('cashier success message never shows modal value, only the unpriced warning', async () => {
 s.failure = false; s.responseMode = 'values';
 let msg = ''; try { await simpanHasil(form()); } catch (e) { msg = (e as Error).message; }
 expect(msg).toContain('success='); expect(msg).not.toContain('Nilai selisih'); expect(msg).not.toContain('Rp 500'); expect(msg).toContain('Barang Z');
});
it('an old receipt without the new keys still reports success without invented numbers', async () => {
 s.failure = false; s.responseMode = ''; const f = form(); f.set('kembali', 'office');
 let msg = ''; try { await simpanHasil(f); } catch (e) { msg = (e as Error).message; }
 expect(msg).toContain('tersimpan'); expect(msg).not.toContain('Nilai selisih');
});

it('passes the database refusal through unchanged: the guidance now lives in the database message (first-lock rule)', async () => {
  s.failMsg = 'Hitungan barang berikut perlu diulang karena ...: Barang X (dihitung 0, stok saat dikunci 11, sejak itu berubah -11, stok sekarang 0). Hitungan harus sama dengan isi rak PADA SAAT barang pertama kali dikunci (isi rak sekarang ditambah yang sudah terjual sejak itu), bukan isi rak sekarang.';
  let msg = ''; try { await simpanHasil(form()); } catch (e) { msg = (e as Error).message; }
  expect(msg).toContain('Barang X (dihitung 0, stok saat dikunci 11, sejak itu berubah -11, stok sekarang 0)');
  expect(msg).toContain('PADA SAAT barang pertama kali dikunci');
  expect(msg).not.toContain('jangan isi stok awal opname');
});
it('tells the user how many items moved (sold/received) since they were counted, as already handled automatically', async () => {
  s.failure = false; s.responseMode = 'moved';
  let msg = ''; try { await simpanHasil(form()); } catch (e) { msg = (e as Error).message; }
  expect(msg).toContain('success='); expect(msg).toContain('2 barang terjual/masuk/pindah sejak dihitung; sudah dihitung otomatis, bukan selisih.');
});
it('an unlocked-and-moved refusal from the database is shown as is', async () => {
  s.failMsg = 'Barang berikut belum dikunci dan stoknya sudah bergerak (terjual, masuk, atau dipindah) sejak opname dimulai, jadi sistem tidak tahu hitungan itu dibuat sebelum atau sesudah pergerakan: Barang Y. Tekan Kunci pada barang tersebut tepat sesudah dihitung, lalu simpan lagi.';
  let msg = ''; try { await simpanHasil(form()); } catch (e) { msg = (e as Error).message; }
  expect(msg).toContain('Tekan Kunci pada barang tersebut tepat sesudah dihitung'); expect(msg).toContain('error=');
});
