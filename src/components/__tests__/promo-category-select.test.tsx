// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect';
const options = Array.from({ length: 1205 }, (_, i) => ({ id: `i${i}`, code: `SKU-${i}`, name: `Fictional item ${i}`, categoryId: i === 0 ? 'other' : 'child', categoryLabel: i === 0 ? 'Lainnya' : 'Makanan › Anak' }));
const categories = [{ id: 'food', label: 'Makanan', includes: ['food', 'child'] }, { id: 'child', label: 'Makanan › Anak', includes: ['child'] }, { id: 'empty', label: 'Tanpa kategori', includes: [''] }];
let root: Root, host: HTMLDivElement, submitted: boolean;
function Fixture() {
  const [value, setValue] = useState(['i0']);
  return <form onSubmit={e => { e.preventDefault(); submitted = true; }}><SearchableMultiSelect name="item_ids" label="barang promo" options={options} categories={categories} value={value} onChange={setValue}/><button>Simpan</button></form>;
}
const values = () => new FormData(host.querySelector('form')!).getAll('item_ids');
async function category(id: string) {
  const select = host.querySelector<HTMLSelectElement>('[aria-label="Kategori barang promo"]');
  expect(select).not.toBeNull();
  await act(async () => { select!.value = id; select!.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function search(text: string) {
  const input = host.querySelector<HTMLInputElement>('[role=combobox]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
  return input;
}
const button = (prefix: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.startsWith(prefix))!;
beforeEach(async () => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); submitted = false; host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(<Fixture/>)); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('selects all category matches beyond the visible page and preserves selections outside the filter', async () => {
  await category('food');
  expect(host.textContent).toContain('1204 hasil pencarian');
  await act(async () => button('Pilih semua hasil').click());
  expect(values()).toHaveLength(1205);
  await act(async () => button('Lepas semua hasil').click());
  expect(values()).toEqual(['i0']);
});
it('combines category with code search, keyboard selection and explicit clear without submitting', async () => {
  await category('child'); const input = await search('SKU-1204');
  expect(host.textContent).toContain('Makanan › Anak');
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  expect(values()).toEqual(['i0', 'i1204']); expect(submitted).toBe(false);
  await category('empty'); expect(host.textContent).toContain('Tidak ada hasil.'); expect(values()).toEqual(['i0', 'i1204']);
  await category(''); await search('SKU-1204'); expect(host.querySelectorAll('[role=option]')).toHaveLength(1);
});
