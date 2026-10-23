// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/(app)/crm/promo/actions', () => ({ createPromo: vi.fn(), togglePromo: vi.fn() }));
const db = vi.hoisted(() => ({ requests: [] as { table: string; from?: number; active?: boolean; ids?: string[] }[], broken: '' }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'fixture-owner' } } }) }, from(table: string) {
  const req = { table } as { table: string; from?: number; to?: number; active?: boolean; ids?: string[] }; db.requests.push(req);
  const q = { select() { return q; }, eq(key: string, value: boolean) { if (key === 'is_active') req.active = value; return q; }, in(key: string, ids: string[]) { if (key === 'id') req.ids = ids; return q; }, order() { return q; }, range(from: number, to: number) { req.from = from; req.to = to; return q; }, then(resolve: (v: unknown) => unknown) {
    let rows: Record<string, unknown>[] = [];
    if (table === 'item_categories') rows = Array.from({ length: 1003 }, (_, i) => ({ id: `c${i}`, name: i === 0 ? 'Makanan' : i === 1 ? 'Anak kucing' : i === 2 ? 'Aksesoris' : `Kategori ${i}`, parent_id: i === 1 ? 'c0' : null, is_active: i !== 2 }));
    if (table === 'items') rows = [{ id: 'food', code: 'FOOD', name: 'Pakan fiktif', category_id: 'c1', is_active: true }, { id: 'empty', code: 'EMPTY', name: 'Barang tanpa kategori', category_id: null, is_active: true }, { id: 'old', code: 'OLD', name: 'Barang nonaktif', category_id: 'c2', is_active: false }, { id: 'last', code: 'LAST', name: 'Kategori terakhir', category_id: 'c1002', is_active: true }];
    if (table === 'promos') rows = ['food', 'empty', 'old', 'gone', 'all', 'last'].map(id => ({ id, name: `Promo ${id}`, promo_type: 'diskon_produk', rule: {}, is_active: true, branch_ids: [], valid_from: null, valid_until: null }));
    if (table === 'promo_items') rows = ['food', 'empty', 'old', 'gone', 'last'].map(id => ({ promo_id: id, item_id: id }));
    if (req.active !== undefined) rows = rows.filter(r => r.is_active === req.active);
    if (req.ids) rows = rows.filter(r => req.ids!.includes(String(r.id)));
    return Promise.resolve({ data: rows.slice(req.from ?? 0, req.to === undefined ? 1000 : req.to + 1), count: rows.length, error: table === db.broken ? { message: 'fixture read denied' } : null }).then(resolve);
  } }; return q;
} }) }));
import Page from '@/app/(app)/crm/promo/page';
let root: Root, host: HTMLDivElement;
async function render(kategori?: string) { const page = await Page({ searchParams: Promise.resolve({ kategori }) }); await act(async () => root.render(page)); }
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); db.requests = []; db.broken = ''; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('labels hierarchy, inactive, empty and unavailable category honestly and reads complete category pages', async () => {
  await render(); const table = host.querySelector('tbody')!;
  expect(table.textContent).toContain('Makanan › Anak kucing'); expect(table.textContent).toContain('Aksesoris (nonaktif)'); expect(table.textContent).toContain('Tanpa kategori'); expect(table.textContent).toContain('Kategori tidak tersedia'); expect(table.textContent).toContain('Semua kategori');
  expect(db.requests.some(r => r.table === 'item_categories' && r.from === 1000)).toBe(true);
  expect(host.querySelector('[aria-label="Kategori daftar promo"]')).not.toBeNull();
});
it('filters a parent category including descendants and global promotions without widening explicit targets', async () => {
  await render('c0'); const text = host.querySelector('tbody')!.textContent;
  expect(text).toContain('Promo food'); expect(text).toContain('Promo all'); expect(text).not.toContain('Promo old'); expect(text).not.toContain('Promo empty'); expect(text).not.toContain('Promo gone');
});
it('keeps existing inactive targets visible as information while selector remains active-only', async () => {
  await render('c2'); expect(host.querySelector('tbody')!.textContent).toContain('Barang nonaktif');
  const input = host.querySelector<HTMLInputElement>('[aria-label="Cari barang promo"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'OLD'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(host.querySelector('[role=listbox]')!.textContent).toContain('Tidak ada hasil.');
});
it('fails closed when category metadata or stored target links cannot be loaded completely', async () => {
  db.broken = 'item_categories'; await expect(render()).rejects.toThrow('belum dapat dimuat lengkap');
  db.broken = 'promo_items'; await expect(render()).rejects.toThrow('belum dapat dimuat lengkap');
});
it('finds a category beyond the first thousand and does not silently ignore an invalid category filter', async () => {
  await render('c1002'); const text = host.querySelector('tbody')!.textContent; expect(text).toContain('Promo last'); expect(text).not.toContain('Promo food');
  await render('missing-id'); expect(host.textContent).toContain('Filter kategori tidak tersedia'); expect(host.querySelector('tbody')!.textContent).not.toContain('Promo food');
});
