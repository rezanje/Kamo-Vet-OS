// @vitest-environment jsdom
// Daftar promo (CRM → Promo) harus bisa dibaca sekilas oleh pemilik toko:
// mana yang benar-benar memotong uang, mana yang cuma pengingat, dan mana yang
// sudah lewat tanggal. Pola fixture-nya mengikuti promo-category-page.test.tsx.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/(app)/crm/promo/actions', () => ({ createPromo: vi.fn(), togglePromo: vi.fn() }));
const db = vi.hoisted(() => ({ rpc: [] as string[] }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'fixture-owner' } } }) },
  rpc(name: string) { db.rpc.push(name); return Promise.resolve({ data: null, error: null }); },
  from(table: string) {
    const req = {} as { from?: number; to?: number };
    const q = { select() { return q; }, maybeSingle: async () => ({ data: { role: 'OWNER', is_active: true } }),
      eq() { return q; }, in() { return q; }, order() { return q; },
      range(from: number, to: number) { req.from = from; req.to = to; return q; },
      then(resolve: (v: unknown) => unknown) {
        let rows: Record<string, unknown>[] = [];
        if (table === 'promos') rows = [
          // Tetap is_active true: begitulah barisnya terlihat di antara dua
          // jalannya penyapu, dan label "Kadaluarsa" tetap harus menang.
          { id: 'habis', name: 'diskon aatas', promo_type: 'diskon_produk', rule: {}, is_active: true,
            branch_ids: [], valid_from: '2026-10-13', valid_until: '2026-10-13', auto_apply: true,
            min_qty: 1, max_qty: 1, kelipatan: true, discount_type: 'nominal', discount_value: 1000 },
          { id: 'otomatis', name: 'Promo potong sendiri', promo_type: 'diskon_produk', rule: {}, is_active: true,
            branch_ids: [], valid_from: null, valid_until: null, auto_apply: true,
            min_qty: null, max_qty: null, kelipatan: false, discount_type: 'percent', discount_value: 10 },
          { id: 'pengingat', name: 'Promo pengingat saja', promo_type: 'diskon_produk', rule: {}, is_active: true,
            branch_ids: [], valid_from: null, valid_until: null, auto_apply: false,
            min_qty: null, max_qty: null, kelipatan: false, discount_type: 'percent', discount_value: 10 },
        ];
        return Promise.resolve({ data: rows.slice(req.from ?? 0, req.to === undefined ? 1000 : req.to + 1), count: rows.length, error: null }).then(resolve);
      } };
    return q;
  } }) }));
import Page from '@/app/(app)/crm/promo/page';

let root: Root, host: HTMLDivElement;
const baris = (id: string) => [...host.querySelectorAll('tbody tr')].find(tr => tr.querySelector(`a[href="/crm/promo/${id}/edit"]`))!;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T03:00:00Z'));
  db.rpc = []; sessionStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(await Page({ searchParams: Promise.resolve({}) })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it('membedakan promo yang memotong sendiri dari yang cuma pengingat, lengkap dengan warnanya', () => {
  const otomatis = baris('otomatis').querySelector('.bge.g')!;
  expect(otomatis.textContent).toBe('Potong otomatis');
  const pengingat = baris('pengingat').querySelector('.bge.o')!;
  expect(pengingat.textContent).toBe('Pengingat saja — tidak memotong');
  expect([...baris('pengingat').querySelectorAll('.bge.g')].map(b => b.textContent)).not.toContain('Potong otomatis');
  expect([...host.querySelectorAll('thead th')].map(th => th.textContent)).toContain('Cara potong');
});

it('menjelaskan arti kedua label dalam satu baris keterangan', () => {
  const teks = host.textContent ?? '';
  expect(teks).toContain('potongan langsung terhitung sendiri di kasir begitu syaratnya terpenuhi');
  expect(teks).toContain('tidak ada potongan kecuali pelanggan memakai kode kampanye');
});

it('promo lewat tanggal berlabel Kadaluarsa, bukan Aktif hijau', () => {
  const habis = baris('habis');
  expect(habis.querySelector('.bge.x')!.textContent).toBe('Kadaluarsa');
  expect([...habis.querySelectorAll('.bge.g')].map(b => b.textContent)).not.toContain('Aktif hari ini');
  expect(baris('otomatis').textContent).toContain('Aktif hari ini');
});

it('menyapu yang sudah lewat tanggal sebelum daftarnya dibaca', () => {
  expect(db.rpc).toEqual(['nonaktifkan_promo_kadaluarsa']);
});
