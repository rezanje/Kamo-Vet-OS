// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { CompoundEditor } from '../CompoundEditor';
import type { KatalogRacikan } from '@/lib/katalog-racikan';
import { masterCompoundCartRow, type CompoundDraft } from '@/lib/master-compound-cart';

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
  const picker=host.querySelector<HTMLInputElement>('[aria-label="Komposisi racikan"]')!;
  await act(async()=>picker.focus());
  const options=[...document.querySelectorAll('[role=option]')];
  expect(options).toHaveLength(1);expect(options[0].textContent).toContain('Formula A (v1)');expect(options[0].textContent).toContain('Kode: A');
  await act(async()=>picker.blur());
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

it('copies an official recipe into an editable patient composition without issuing the fixed formula', async () => {
  root = createRoot(host);
  const material = { id: 'material', name: 'Bahan aktif', unit: 'gram', sell_price: 20, stok: 10 };
  const official = { ...formula, sale_item_id: 'sku', dosage_instruction: 'Instruksi resmi', ingredients: [
    { item_id: 'material', name: 'Nama lama', quantity: 1, unit: 'gram', unit_price: 10 },
  ] } as KatalogRacikan;
  let draft: CompoundDraft = { saleItemId: 'sku', formulaId: 'version', dosageForm: 'puyer', instruction: '', ingredients: [] };
  function Harness() {
    const [value, setValue] = useState(draft);
    return <CompoundEditor items={[item]} materials={[material]} catalog={[official]} allowCustom value={value}
      onChange={next => { draft = next; setValue(next); }} />;
  }
  await act(async () => root.render(<Harness />));
  const copy = [...host.querySelectorAll('button')].find(button => button.textContent === 'Sesuaikan komposisi untuk pasien');
  expect(copy).toBeDefined();
  await act(async () => copy!.click());
  expect(draft).toMatchObject({ formulaId: '', dosageForm: 'puyer', instruction: 'Instruksi resmi', ingredients: [
    { item_id: 'material', nama: 'Bahan aktif', qty: 1, satuan: 'gram', harga: 20 },
  ] });
  const quantity = host.querySelector<HTMLInputElement>('[aria-label="Jumlah bahan Bahan aktif"]')!;
  expect(quantity).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(quantity, '2'); quantity.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(masterCompoundCartRow(item, null, draft, 'request', true)).toMatchObject({
    official_version_id: undefined, ingredients: [{ item_id: 'material', qty: 2 }],
  });
});

it('does not offer a patient copy without current custom permission and matching active ingredient units', async () => {
  root = createRoot(host);
  const official = { ...formula, sale_item_id: 'sku', ingredients: [
    { item_id: 'material', name: 'Bahan', quantity: 1, unit: 'gram', unit_price: 10 },
  ] } as KatalogRacikan;
  const value = { saleItemId: 'sku', formulaId: 'version', dosageForm: 'puyer', instruction: '', ingredients: [] };
  const copyButton = () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Sesuaikan komposisi untuk pasien');
  await act(async () => root.render(<CompoundEditor items={[item]} materials={[]} catalog={[official]} allowCustom value={value} onChange={() => {}} />));
  expect(copyButton()).toBeUndefined();
  expect(host.textContent).toContain('bahan atau satuan aktif tidak cocok');
  await act(async () => root.render(<CompoundEditor items={[item]} materials={[{ id: 'material', name: 'Bahan', unit: 'gram', sell_price: 20, stok: 10 }]} catalog={[official]} allowCustom={false} value={value} onChange={() => {}} />));
  expect(copyButton()).toBeUndefined();
});

it('K03 keeps every active compound SKU visible before typing and selects it into the composition flow', async () => {
  root = createRoot(host);
  const second = { id: 'sku-b', name: 'Obat Racik B', unit: 'pcs', sell_price: 200, stok: 0, code: 'RB' };
  const catalog = [{ ...formula, sale_item_id: 'sku' }] as KatalogRacikan[];
  let draft: CompoundDraft = { saleItemId: '', formulaId: '', dosageForm: 'puyer', instruction: '', ingredients: [] };
  function Harness({ allowCustom }: { allowCustom: boolean }) {
    const [value, setValue] = useState(draft);
    return <CompoundEditor items={[item, second]} materials={[]} catalog={catalog} allowCustom={allowCustom} value={value}
      onChange={next => { draft = next; setValue(next); }} />;
  }
  await act(async () => root.render(<Harness allowCustom={false} />));
  expect(host.textContent).toContain('Obat racik dari Barang & Jasa (2)');
  expect(host.querySelector('[aria-label="Pilih Obat Racik A"]')).toBeTruthy();
  const pickB = host.querySelector<HTMLButtonElement>('[aria-label="Pilih Obat Racik B"]');
  expect(pickB).toBeTruthy();
  expect(pickB!.textContent).toContain('Belum ada resep resmi');
  expect(host.querySelector('[aria-label="Pilih Obat Racik A"]')!.textContent).toContain('1 resep resmi');
  await act(async () => pickB!.click());
  expect(draft.saleItemId).toBe('sku-b');
  expect(host.textContent).toContain('Komposisi racikan');
  expect(host.querySelector('[aria-label="Pilih Obat Racik A"]')).toBeNull();
  expect(host.querySelector<HTMLButtonElement>('.btn-acc')?.disabled).toBe(true);
});
