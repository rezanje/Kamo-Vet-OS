// @vitest-environment jsdom
// KPI "Promo aktif" / "Voucher aktif" di Dashboard → Marketing.
//
// Penyapu kedaluwarsa (lib/promo-kadaluarsa.ts) tidak dipanggil dari layar ini,
// jadi di antara dua jalannya penyapu baris yang sudah lewat tanggal MASIH
// tersimpan is_active = true. Angka di sini tidak boleh ikut menghitungnya:
// yang dijanjikan "aktif" harus benar-benar memotong di kasir hari ini.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/dashboard', () => ({ getDashboard: vi.fn() }));
vi.mock('@/lib/pending-work', () => ({ loadPendingWork: async () => [] }));
vi.mock('@/components/Charts', () => ({ Donut: () => null, LineChart: () => null, CashFlowChart: () => null }));

type Baris = Record<string, unknown>;
const FIXTURE: Record<string, Baris[]> = {
  promos: [
    { id: 'panjang', is_active: true, valid_until: '2026-12-31' },
    { id: 'selamanya', is_active: true, valid_until: null },
    // Lewat tanggal tapi belum tersapu — inilah yang dulu ikut terhitung.
    { id: 'lewat', is_active: true, valid_until: '2026-10-13' },
    { id: 'dimatikan', is_active: false, valid_until: null },
  ],
  vouchers: [
    { id: 'v-panjang', is_active: true, valid_until: '2026-11-30' },
    { id: 'v-lewat', is_active: true, valid_until: '2026-10-28' },
  ],
  customers: [],
  sale_items: [],
};

// Evaluator filter PostgREST seadanya: cukup untuk eq + or(is.null / gte) supaya
// yang diuji benar-benar angkanya, bukan susunan pemanggilannya.
function cocok(baris: Baris, klausa: string): boolean {
  const [kolom, op, nilai] = klausa.split('.');
  if (op === 'is' && nilai === 'null') return baris[kolom] === null;
  if (op === 'gte') return typeof baris[kolom] === 'string' && (baris[kolom] as string) >= nilai;
  throw new Error(`filter belum didukung fixture: ${klausa}`);
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'fixture-admin' } } }) },
  from(table: string) {
    let rows = [...(FIXTURE[table] ?? [])];
    const q = {
      select() { return q; },
      eq(kolom: string, nilai: unknown) {
        if (table !== 'profiles') rows = rows.filter((r) => r[kolom] === nilai);
        return q;
      },
      or(expr: string) { rows = rows.filter((r) => expr.split(',').some((c) => cocok(r, c))); return q; },
      gt() { rows = []; return q; },
      gte() { rows = []; return q; },
      maybeSingle: async () => ({ data: table === 'profiles' ? { role: 'ADMIN' } : null, error: null }),
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve({ data: rows, count: rows.length, error: null }).then(resolve);
      },
    };
    return q;
  },
}) }));

import Dashboard from '@/app/(app)/page';

let root: Root, host: HTMLDivElement;
const kpi = (label: string) => [...host.querySelectorAll('.kcard')]
  .find((c) => c.querySelector('.klab')?.textContent === label)?.querySelector('.kval')?.textContent;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T03:00:00Z'));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  // Dashboard mengembalikan <DashboardLain/> — komponen server async lagi —
  // yang tidak bisa dirender react-dom langsung; jadi diselesaikan di sini.
  const luar = await Dashboard({ searchParams: Promise.resolve({ sudut: 'marketing' }) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = luar as any;
  const isi = typeof el?.type === 'function' ? await el.type(el.props) : el;
  await act(async () => root.render(isi));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it('tidak menghitung promo yang sudah lewat tanggal sebagai promo aktif', () => {
  expect(kpi('Promo aktif')).toBe('2');
});

it('tidak menghitung voucher yang sudah lewat tanggal sebagai voucher aktif', () => {
  expect(kpi('Voucher aktif')).toBe('1');
});
