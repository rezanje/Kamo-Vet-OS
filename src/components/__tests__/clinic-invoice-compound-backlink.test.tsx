// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

type Recipe = { id: string; medical_records: { visit_id: string } | null } | null;
const visitId = '10000000-0000-4000-8000-000000000001';
const invoiceId = '20000000-0000-4000-8000-000000000002';
const recipeId = '30000000-0000-4000-8000-000000000003';
const state = vi.hoisted(() => ({ recipe: null as Recipe, selected: [] as string[] }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from(table: string) {
  const query = {
    select(columns: string) { if (table === 'invoice_items') state.selected.push(columns); return query; },
    eq() { return query; }, is() { return query; }, order() { return query; }, limit() { return query; },
    maybeSingle: async () => ({ data: table === 'visits' ? { id: visitId, poli: 'Umum', created_at: '2026-10-24T00:00:00Z' } : table === 'invoices' ? {
      id: invoiceId, invoice_no: 'INV-FICTION', subtotal: 100, discount: 0, tax: 0, total: 100, dp_amount: 0, paid_status: 'Lunas', created_at: '2026-10-24T00:00:00Z',
    } : null, error: null }),
    then(resolve: (result: unknown) => unknown) { return Promise.resolve({ data: table === 'invoice_items' ? [{
      deskripsi: 'Racikan fiktif', qty: 1, harga: 100, diskon_persen: 0, jenis: 'obat', compound_recipe_id: recipeId, compounding_recipes: state.recipe,
    }] : [], error: null }).then(resolve); },
  };
  return query;
} }) }));
import Page from '@/app/(app)/klinik/pembayaran/[visitId]/invoice/page';

beforeEach(() => { state.recipe = null; state.selected = []; });
async function html() { return renderToStaticMarkup(await Page({ params: Promise.resolve({ visitId }), searchParams: Promise.resolve({ invoice_id: invoiceId }) })); }

it('opens the exact readable compound recipe from its saved invoice line without printing internal navigation', async () => {
  state.recipe = { id: recipeId, medical_records: { visit_id: visitId } };
  const output = await html();
  document.body.innerHTML = output;
  const link = document.querySelector<HTMLAnchorElement>(`a[href="/klinik/racik/${recipeId}"]`);
  expect(link).not.toBeNull();
  expect(link?.closest('.no-print')).not.toBeNull();
  expect(state.selected[0]).toContain('compounding_recipes');
});

it('does not expose a recipe hidden by access rules or belonging to another visit', async () => {
  expect(await html()).not.toContain(`href="/klinik/racik/${recipeId}"`);
  state.recipe = { id: recipeId, medical_records: { visit_id: 'other-visit' } };
  expect(await html()).not.toContain(`href="/klinik/racik/${recipeId}"`);
});
