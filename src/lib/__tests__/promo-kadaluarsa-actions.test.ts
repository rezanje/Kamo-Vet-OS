// Pagar formulir: promo/voucher/kode yang sudah lewat tanggal tidak bisa
// dihidupkan lagi sebelum masa berlakunya diperpanjang. Database menolak juga
// (migrasi 20261102010000); yang diuji di sini pesannya ke pengguna dan bahwa
// tulisnya memang tidak terjadi.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  role: 'OWNER',
  rows: {} as Record<string, Record<string, unknown> | null>,
  writes: [] as { table: string; values: Record<string, unknown> }[],
}));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/master-guard', () => ({ assertMasterAdmin: async () => klien() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => klien() }));

function klien() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'fixture-owner' } } }) },
    from(table: string) {
      const q = {
        select(kolom: string) { q.kolom = kolom; return q; },
        update(values: Record<string, unknown>) { db.writes.push({ table, values }); return q; },
        eq() { return q; },
        kolom: '',
        maybeSingle: async () => ({ data: table === 'profiles' ? { role: db.role, is_active: true } : db.rows[table] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return q;
    },
  };
}

import { togglePromo } from '@/app/(app)/crm/promo/actions';
import { toggleVoucher } from '@/app/(app)/crm/voucher/actions';
import { aturStatusKodeKampanye } from '@/app/(app)/crm/kampanye/actions';

const ID = 'a0000000-0000-4000-8000-000000000001';
const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

beforeEach(() => {
  db.role = 'OWNER'; db.rows = {}; db.writes = [];
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T03:00:00Z')); // 10:00 WIB
});
afterEach(() => vi.useRealTimers());

it('menolak menghidupkan promo yang masa berlakunya sudah lewat, tanpa menulis apa pun', async () => {
  db.rows.promos = { name: 'diskon aatas', valid_until: '2026-10-13' };
  await expect(togglePromo(form({ id: ID, active: '1' }))).rejects.toThrow(/sudah%20melewati%20masa%20berlaku/);
  await expect(togglePromo(form({ id: ID, active: '1' }))).rejects.toThrow(/Perpanjang/);
  expect(db.writes).toEqual([]);
});

it('tetap boleh MEMATIKAN promo kedaluwarsa dan menghidupkan promo yang tanggalnya diperpanjang', async () => {
  db.rows.promos = { name: 'diskon aatas', valid_until: '2026-10-13' };
  await expect(togglePromo(form({ id: ID, active: '0' }))).rejects.toThrow('/crm/promo');
  expect(db.writes).toEqual([{ table: 'promos', values: { is_active: false } }]);

  db.writes = [];
  db.rows.promos = { name: 'diskon aatas', valid_until: '2026-11-30' };
  await expect(togglePromo(form({ id: ID, active: '1' }))).rejects.toThrow('/crm/promo');
  expect(db.writes).toEqual([{ table: 'promos', values: { is_active: true } }]);
});

it('hari terakhir masih boleh diaktifkan — batasnya tengah malam WIB, bukan pagi UTC', async () => {
  db.rows.promos = { name: 'diskon aatas', valid_until: '2026-10-29' };
  await expect(togglePromo(form({ id: ID, active: '1' }))).rejects.toThrow('/crm/promo');
  expect(db.writes).toEqual([{ table: 'promos', values: { is_active: true } }]);

  db.writes = [];
  vi.setSystemTime(new Date('2026-10-29T17:30:00Z')); // 00:30 WIB tanggal 30
  await expect(togglePromo(form({ id: ID, active: '1' }))).rejects.toThrow(/sudah%20melewati/);
  expect(db.writes).toEqual([]);
});

it('berlaku sama untuk voucher', async () => {
  db.rows.vouchers = { code: 'HEMAT10', valid_until: '2026-10-13' };
  await expect(toggleVoucher(form({ id: ID, aktif: '0' }))).rejects.toThrow(/HEMAT10/);
  expect(db.writes).toEqual([]);

  await expect(toggleVoucher(form({ id: ID, aktif: '1' }))).rejects.toThrow('/crm/voucher');
  expect(db.writes).toEqual([{ table: 'vouchers', values: { is_active: false } }]);
});

it('kode kampanye ikut ditolak selama promo tujuannya belum diperpanjang', async () => {
  db.rows.campaign_codes = { code: 'KAMOGAJIAN', promo_id: 'p1', voucher_id: null };
  db.rows.promos = { name: 'diskon aatas', valid_until: '2026-10-13' };
  await expect(aturStatusKodeKampanye(form({ id: ID, is_active: '1' }))).rejects.toThrow(/KAMOGAJIAN/);
  expect(db.writes).toEqual([]);

  db.rows.promos = { name: 'diskon aatas', valid_until: '2026-11-30' };
  await expect(aturStatusKodeKampanye(form({ id: ID, is_active: '1' }))).rejects.toThrow('/crm/kampanye');
  expect(db.writes).toHaveLength(1);
  expect(db.writes[0].values).toMatchObject({ is_active: true });
});
