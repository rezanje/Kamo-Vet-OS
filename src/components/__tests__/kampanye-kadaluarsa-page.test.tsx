// @vitest-environment jsdom
// Kode kampanye tidak punya masa berlaku sendiri — yang kedaluwarsa adalah
// promo/voucher tujuannya. Daftar ini harus ikut jujur: kode yang di kasir
// sudah tidak memotong apa pun tidak boleh tampil hijau "Aktif".
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/app/(app)/crm/kampanye/actions', () => ({ simpanKodeKampanye: vi.fn(), aturStatusKodeKampanye: vi.fn() }));
vi.mock('@/lib/master-guard', () => ({ bolehKelolaMaster: async () => true }));
const db = vi.hoisted(() => ({ rpc: [] as string[] }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  rpc(name: string) { db.rpc.push(name); return Promise.resolve({ data: [], error: null }); },
  from(table: string) {
    const q = { select() { return q; }, eq() { return q; },
      order() {
        const rows: Record<string, Record<string, unknown>[]> = {
          campaign_codes: [
            { id: 'k-habis', code: 'KAMOGAJIAN', voucher_id: null, promo_id: 'p-habis', max_uses: null, is_active: true, note: null },
            { id: 'k-hidup', code: 'KAMOBARU', voucher_id: null, promo_id: 'p-hidup', max_uses: null, is_active: true, note: null },
            { id: 'k-voucher', code: 'KAMOVOUCHER', voucher_id: 'v-habis', promo_id: null, max_uses: null, is_active: true, note: null },
          ],
          promos: [
            { id: 'p-habis', name: 'diskon aatas', is_active: true, auto_apply: true, valid_until: '2026-10-13' },
            { id: 'p-hidup', name: 'Promo jalan terus', is_active: true, auto_apply: true, valid_until: null },
          ],
          vouchers: [{ id: 'v-habis', code: 'HEMAT10', is_active: true, valid_until: '2026-10-13' }],
        };
        return Promise.resolve({ data: rows[table] ?? [], error: null });
      } };
    return q;
  } }) }));
import Page from '@/app/(app)/crm/kampanye/page';

let root: Root, host: HTMLDivElement;
const baris = (kode: string) => [...host.querySelectorAll('tbody tr')].find(tr => tr.textContent?.includes(kode))!;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T03:00:00Z')); // 10:00 WIB
  db.rpc = [];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(await Page({ searchParams: Promise.resolve({}) })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it('menyapu promo/voucher kedaluwarsa sebelum daftar kode dibaca', () => {
  expect(db.rpc).toContain('nonaktifkan_promo_kadaluarsa');
});

// Baris fixture-nya sengaja masih is_active = true: begitulah bentuknya kalau
// penyapu gagal jalan (mis. migrasinya belum diterapkan). Labelnya tetap harus
// benar tanpa bergantung pada penyapu itu.
it('kode yang promonya sudah lewat tanggal berlabel Kadaluarsa, bukan Aktif hijau', () => {
  expect(baris('KAMOGAJIAN').querySelector('.bge')!.textContent).toBe('Kadaluarsa');
  expect(baris('KAMOGAJIAN').querySelector('.bge')!.classList.contains('g')).toBe(false);
});

it('kode yang voucher tujuannya lewat tanggal ikut Kadaluarsa', () => {
  expect(baris('KAMOVOUCHER').querySelector('.bge')!.textContent).toBe('Kadaluarsa');
});

it('kode yang tujuannya masih berjalan tetap Aktif', () => {
  const bge = baris('KAMOBARU').querySelector('.bge')!;
  expect(bge.textContent).toBe('Aktif');
  expect(bge.classList.contains('g')).toBe(true);
});
