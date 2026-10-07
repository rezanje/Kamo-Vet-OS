// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CompoundEditor } from '../CompoundEditor';
import type { KatalogRacikan } from '@/lib/katalog-racikan';

const item = { id: 'sku', name: 'Obat Racik A', unit: 'pcs', sell_price: 100, stok: 0 };
const formula = { id: 'formula', code: 'A', active: true, version_id: 'version', version: 1, name: 'Formula A', dosage_form: 'puyer', dosage_instruction: null, ingredients: [] };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const host = document.createElement('div');
document.body.append(host);
let root: ReturnType<typeof createRoot>;
afterEach(async () => { if (root) await act(async () => root.unmount()); });

it('exposes only the selected SKU’s explicitly bound active formulas and rejects stale mismatches', async () => {
  root = createRoot(host);
  const catalog = [
    { ...formula, sale_item_id: 'sku' },
    { ...formula, id: 'other', version_id: 'other-version', sale_item_id: 'other-sku' },
    { ...formula, id: 'unassigned', version_id: 'unassigned-version', sale_item_id: null },
    { ...formula, id: 'inactive', version_id: 'inactive-version', sale_item_id: 'sku', active: false },
  ] as KatalogRacikan[];
  const render = async (formulaId: string, allowCustom = false) => act(async () => root.render(<CompoundEditor items={[item]} materials={[]} catalog={catalog} allowCustom={allowCustom} value={{ saleItemId: 'sku', formulaId, dosageForm: 'puyer', instruction: '', ingredients: [{ item_id: 'material', nama: 'Test material', qty: 1, satuan: 'gram', harga: 10 }] }} onChange={() => {}} />));
  await render('other-version');
  expect([...host.querySelectorAll('option')].map(option => option.value)).toEqual(['', 'version']);
  expect(host.querySelector<HTMLButtonElement>('.btn-acc')?.disabled).toBe(true);
  await render('version');
  expect(host.querySelector<HTMLButtonElement>('.btn-acc')?.disabled).toBe(false);
  await render('unassigned-version');
  expect(host.querySelector<HTMLButtonElement>('.btn-acc')?.disabled).toBe(true);
  await render('other-version', true);
  expect(host.querySelector<HTMLButtonElement>('.btn-acc')?.disabled).toBe(true);
  await render('', true);
  expect(host.querySelector<HTMLButtonElement>('.btn-acc')?.disabled).toBe(false);
});
