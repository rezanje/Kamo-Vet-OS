import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as { id: string; invoice_id: string; invoices: { id: string; visit_id: string; invoice_no: string; voided_at: string | null } | null }[],
  failed: false,
  filters: [] as { table: string; key: string; value: string }[],
}));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); }, useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/(app)/klinik/racik/actions', () => ({ advanceRecipeStatus: vi.fn(), ubahKomposisiRacikan: vi.fn(), kembalikanBahanRacikan: vi.fn(), bahanRacikanUntukKunjungan: vi.fn(async () => []), updateRacikPetunjuk: vi.fn(), updateRacikPemakaian: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from(table: string) {
  const query = {
    select() { return query; },
    eq(key: string, value: string) { state.filters.push({ table, key, value }); return query; },
    order() { return query; },
    range() { return query; },
    maybeSingle: async () => ({ data: table === 'compounding_recipes' ? {
      id: 'recipe', recipe_name: 'Racikan fiktif', status: 'ready', dosage_instruction: '', total_volume: '1', dosage_form: 'puyer', compounding_steps: '', compound_official_usage: [],
      medical_records: { id: 'record', visit_id: 'visit', visits: { id: 'visit', created_at: '2026-10-24T00:00:00Z' } },
    } : null }),
    then(resolve: (result: unknown) => unknown) { const data = table === 'invoice_items' ? state.rows : []; return Promise.resolve({ data, count: data.length, error: table === 'invoice_items' && state.failed ? { message: 'private source error' } : null }).then(resolve); },
  };
  return query;
} }) }));
import Page from '@/app/(app)/klinik/racik/[recipeId]/page';

const invoice = (id: string, voided_at: string | null = null, visit_id = 'visit') => ({ id: `line-${id}`, invoice_id: id, invoices: { id, visit_id, invoice_no: `INV-${id}`, voided_at } });
beforeEach(() => { state.rows = []; state.failed = false; state.filters = []; });
async function html() { return renderToStaticMarkup(await Page({ params: Promise.resolve({ recipeId: 'recipe' }), searchParams: Promise.resolve({}) })); }

it('links only the saved active invoice containing the recipe and scopes the line lookup by recipe ID', async () => {
  state.rows = [invoice('invoice-1')];
  const output = await html();
  expect(output).toContain('href="/klinik/pembayaran/visit/invoice?invoice_id=invoice-1"');
  expect(output).toContain('INV-invoice-1');
  expect(state.filters).toContainEqual({ table: 'invoice_items', key: 'compound_recipe_id', value: 'recipe' });
});

it('does not route a voided or mismatched-visit invoice as an active invoice', async () => {
  state.rows = [invoice('voided', '2026-10-24T00:00:00Z'), invoice('wrong-visit', null, 'other-visit')];
  const output = await html();
  expect(output).not.toContain('/klinik/pembayaran/visit/invoice?invoice_id=voided');
  expect(output).not.toContain('/klinik/pembayaran/visit/invoice?invoice_id=wrong-visit');
});

it('reports an unverified invoice lookup without claiming no invoice exists', async () => {
  state.failed = true;
  const output = await html();
  expect(output).toContain('Tautan invoice belum dapat diperiksa');
  expect(output).not.toContain('private source error');
  expect(output).not.toContain('Belum ada invoice untuk racikan ini');
});

it('does not claim an inaccessible or absent invoice was never created', async () => {
  const output = await html();
  expect(output).toContain('Belum ada invoice terkait yang tersedia untuk akses Anda');
});
