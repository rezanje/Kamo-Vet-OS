// Pagar pertahanan berlapis: togglePromo (jalur lama, tulis langsung is_active) tidak boleh dipakai untuk promo Promo Paket
// (discount_mode='syarat_hasil'): aktivasi harus lewat set_promo_syarat_hasil_active (token versi + cek duplikat). Perilaku
// promo lama tidak berubah.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown> | null>,
  writes: [] as { table: string; values: Record<string, unknown> }[],
  readError: null as null | { message: string },
}));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => klien() }));

function klien() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'fixture-owner' } } }) },
    from(table: string) {
      const q = {
        select() { return q; },
        update(values: Record<string, unknown>) { db.writes.push({ table, values }); return q; },
        eq() { return q; },
        maybeSingle: async () => (table === 'profiles' ? { data: { role: 'OWNER', is_active: true }, error: null } : { data: db.rows[table] ?? null, error: db.readError }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return q;
    },
  };
}

import { togglePromo } from '@/app/(app)/crm/promo/actions';

const ID = 'a0000000-0000-4000-8000-000000000001';
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const go = (o: Record<string, string>) => togglePromo(form(o)).then(() => 'no-redirect', (e: Error) => decodeURIComponent(e.message));

beforeEach(() => { db.rows = {}; db.writes = []; db.readError = null; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T03:00:00Z')); });
afterEach(() => vi.useRealTimers());

it('refuses to activate OR deactivate a Promo Paket (syarat_hasil) through the legacy direct update, and points to the paket route', async () => {
  db.rows.promos = { name: 'Beli 2 Bolt', valid_until: null, rule: { discount_mode: 'syarat_hasil', syarat_hasil: {} } };
  for (const active of ['1', '0']) {
    const url = await go({ id: ID, active });
    expect(url).toContain('/crm/promo?error=');
    expect(url).toContain('Promo Paket');
    expect(url).toContain('/crm/promo/paket');
  }
  expect(db.writes).toEqual([]);
});

it('legacy promos keep their behaviour: activate, deactivate, expired refusal, package_total rule — no change', async () => {
  db.rows.promos = { name: 'diskon lama', valid_until: null, rule: { suggest: 'x' } };
  expect(await go({ id: ID, active: '1' })).toBe('/crm/promo');
  expect(db.writes).toEqual([{ table: 'promos', values: { is_active: true } }]);
  db.writes = [];
  db.rows.promos = { name: 'paket total', valid_until: null, rule: { discount_mode: 'package_total' } };
  expect(await go({ id: ID, active: '0' })).toBe('/crm/promo');
  expect(db.writes).toEqual([{ table: 'promos', values: { is_active: false } }]);
  db.writes = [];
  db.rows.promos = { name: 'kadaluarsa', valid_until: '2026-10-13', rule: { suggest: 'x' } };
  expect(await go({ id: ID, active: '1' })).toContain('sudah melewati masa berlaku');
  expect(db.writes).toEqual([]);
});

it('an unreadable promo cannot be classified: refuse instead of writing blindly (defence in depth)', async () => {
  db.readError = { message: 'boom' };
  db.rows.promos = null;
  expect(await go({ id: ID, active: '0' })).toContain('/crm/promo?error=');
  expect(db.writes).toEqual([]);
});
