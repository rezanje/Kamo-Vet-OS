// @vitest-environment jsdom
// Daftar promo (CRM → Promo): filter status lewat ?status=, hitungan per status,
// pencarian, baris ringkas (tanggal satu baris, teks panjang dipotong + title),
// semua informasi & aksi lama tetap ada, dan TIDAK ada tombol hapus.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/(app)/crm/promo/actions', () => ({ createPromo: vi.fn(), togglePromo: vi.fn() }));
const db = vi.hoisted(() => ({ promos: [] as Record<string, unknown>[], role: 'OWNER' }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'fixture-owner' } } }) },
  rpc() { return Promise.resolve({ data: null, error: null }); },
  from(table: string) {
    const req = {} as { from?: number; to?: number; active?: boolean };
    const q = { select() { return q; }, maybeSingle: async () => ({ data: { role: db.role, is_active: true } }),
      eq(key: string, v: boolean) { if (key === 'is_active') req.active = v; return q; }, in() { return q; }, order() { return q; },
      range(from: number, to: number) { req.from = from; req.to = to; return q; },
      then(resolve: (v: unknown) => unknown) {
        let rows: Record<string, unknown>[] = [];
        if (table === 'promos') rows = db.promos;
        if (table === 'items') rows = ['A', 'B', 'C', 'D'].map(c => ({ id: `i${c}`, code: c, name: `Barang ${c} panjang sekali`, category_id: null, is_active: true }));
        if (table === 'promo_items') rows = [{ promo_id: 'aktif1', item_id: 'iA' }, { promo_id: 'aktif1', item_id: 'iB' }, { promo_id: 'aktif1', item_id: 'iC' }, { promo_id: 'aktif1', item_id: 'iD' }];
        if (req.active !== undefined) rows = rows.filter(r => r.is_active === req.active);
        return Promise.resolve({ data: rows.slice(req.from ?? 0, req.to === undefined ? 1000 : req.to + 1), count: rows.length, error: null }).then(resolve);
      } };
    return q;
  } }) }));
import Page from '@/app/(app)/crm/promo/page';

const row = (id: string, o: Record<string, unknown> = {}) => ({ id, name: `Promo ${id}`, promo_type: 'diskon_produk', rule: {}, is_active: true,
  branch_ids: [], valid_from: null, valid_until: null, auto_apply: true, min_qty: null, max_qty: null, kelipatan: false, discount_type: 'percent', discount_value: 10, ...o });
const fixture = () => [
  row('kadaluarsa1', { name: 'V GROOMING 50% CS', is_active: false, valid_from: '2026-09-01', valid_until: '2026-10-31' }),
  row('nonaktif1', { name: 'V GROOMING 50% CS', is_active: false }),
  row('aktif1', { valid_from: '2026-11-02', valid_until: '2026-12-31' }),
  row('mendatang1', { valid_from: '2026-11-04' }),
  row('aktif2', { name: 'Diskon Royal Canin' }),
];

let root: Root, host: HTMLDivElement;
async function render(sp: Record<string, string> = {}) { const page = await Page({ searchParams: Promise.resolve(sp) }); await act(async () => root.render(page)); }
const ids = () => [...host.querySelectorAll('tbody tr')].map(tr => tr.querySelector('a[href$="/edit"]')?.getAttribute('href')?.split('/')[3]).filter(Boolean);
const chip = (label: string) => [...host.querySelectorAll('nav[aria-label="Filter status promo"] a')].find(a => a.textContent!.startsWith(label)) as HTMLAnchorElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T03:00:00Z'));
  sessionStorage.clear(); db.promos = fixture(); db.role = 'OWNER';
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it('default Semua: tidak ada yang disembunyikan, urutan aktif → mendatang → nonaktif → kedaluwarsa', async () => {
  await render();
  expect(ids()).toEqual(['aktif1', 'aktif2', 'mendatang1', 'nonaktif1', 'kadaluarsa1']);
  expect(host.textContent).toContain('Menampilkan 5 dari 5 promo');
  expect(chip('Semua').getAttribute('aria-current')).toBe('page');
});

it('chip menampilkan hitungan per status dan menaut ke ?status=', async () => {
  await render();
  expect(chip('Aktif').textContent).toBe('Aktif (2)');
  expect(chip('Mendatang').textContent).toBe('Mendatang (1)');
  expect(chip('Nonaktif').textContent).toBe('Nonaktif (1)');
  expect(chip('Kedaluwarsa').textContent).toBe('Kedaluwarsa (1)');
  expect(chip('Semua').textContent).toBe('Semua (5)');
  expect(chip('Aktif').getAttribute('href')).toBe('/crm/promo?status=aktif');
  expect(chip('Kedaluwarsa').getAttribute('href')).toBe('/crm/promo?status=kedaluwarsa');
});

it.each([
  ['aktif', ['aktif1', 'aktif2']], ['mendatang', ['mendatang1']], ['nonaktif', ['nonaktif1']], ['kedaluwarsa', ['kadaluarsa1']],
])('?status=%s hanya menampilkan baris yang sesuai', async (status, expected) => {
  await render({ status });
  expect(ids()).toEqual(expected);
  expect(host.textContent).toContain(`Menampilkan ${expected.length} dari 5 promo`);
  expect(chip(status[0].toUpperCase() + status.slice(1)).getAttribute('aria-current')).toBe('page');
});

it('?status tak dikenal jatuh ke Semua, bukan daftar kosong', async () => {
  await render({ status: 'ngawur' });
  expect(ids()).toHaveLength(5);
});

it('pencarian nama promo dan nama barang; chip membawa q dan kategori', async () => {
  await render({ q: 'royal' });
  expect(ids()).toEqual(['aktif2']);
  await render({ q: 'barang b' });
  expect(ids()).toEqual(['aktif1']);
  expect(chip('Aktif').getAttribute('href')).toBe('/crm/promo?status=aktif&q=barang+b');
  expect(host.textContent).toContain('Menampilkan 1 dari 5 promo');
});

it('pesan kosong khusus filter, bukan "Belum ada promo"', async () => {
  await render({ status: 'aktif', q: 'tidak-ada' });
  expect(host.querySelector('tbody')!.textContent).toContain('Tidak ada promo pada filter ini.');
});

it('tanggal satu baris, teks barang dipotong dengan title penuh, informasi lama tetap ada', async () => {
  await render({ status: 'aktif' });
  const tr = [...host.querySelectorAll('tbody tr')].find(r => r.querySelector('a[href="/crm/promo/aktif1/edit"]'))!;
  expect(tr.textContent).toContain('02 Nov – 31 Des 2026');
  expect(tr.textContent).not.toContain('s/d 2026');
  expect(tr.textContent).toContain('+2 lagi');
  expect(tr.querySelector('[title*="Barang D panjang sekali"]')).not.toBeNull();
  expect(tr.textContent).toContain('Potong otomatis');
  expect(tr.textContent).toContain('10%');
  expect(tr.textContent).toContain('Semua cabang');
  expect(tr.textContent).toContain('Aktif hari ini');
  expect(tr.textContent).toContain('Nonaktifkan');
});

it('semua jalur 1000+ baris dihitung lengkap, tanpa pemotongan diam-diam', async () => {
  db.promos = Array.from({ length: 1203 }, (_, i) => row(`b${i}`, i % 3 === 0 ? { is_active: false } : {}));
  await render({ status: 'semua' });
  expect(host.textContent).toContain('Menampilkan 1203 dari 1203 promo');
  expect(chip('Semua').textContent).toBe('Semua (1203)');
  expect(chip('Nonaktif').textContent).toBe('Nonaktif (401)');
});

it('tidak ada kontrol hapus (belum ada jalur hapus yang aman di database)', async () => {
  await render({ status: 'semua' });
  expect(host.textContent).not.toMatch(/Hapus|Delete/i);
});

it('non-manajer tidak melihat Edit promo', async () => {
  db.role = 'STAFF'; await render();
  expect(host.querySelector('a[href$="/edit"]')).toBeNull();
});
