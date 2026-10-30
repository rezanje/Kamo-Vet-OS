// @vitest-environment jsdom
// Empat promo di Production berstatus "pengingat saja" sementara pemiliknya
// mengira promonya memotong. Konfirmasi ini yang menahan salah paham itu saat
// promo disimpan tanpa "potong otomatis".
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AutoApplyField } from '@/app/(app)/crm/promo/AutoApplyField';

let root: Root, host: HTMLDivElement, form: HTMLFormElement;
const kirim = () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const kotak = () => host.querySelector<HTMLInputElement>('input[name="auto_apply"]')!;

async function render(defaultChecked = false) {
  await act(async () => root.render(<form><AutoApplyField defaultChecked={defaultChecked} /></form>));
  form = host.querySelector('form')!;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it('menjelaskan akibat "pengingat saja" dan membatalkan simpan kalau pemilik mundur', async () => {
  await render();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  expect(kirim()).toBe(false);
  expect(confirm).toHaveBeenCalledTimes(1);
  const pesan = confirm.mock.calls[0][0] as string;
  expect(pesan).toContain('tidak ada potongan');
  expect(pesan).toContain('kode kampanye');
});

it('meneruskan simpan setelah pemilik menyatakan memang itu yang dimaksud', async () => {
  await render();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  expect(kirim()).toBe(true);
});

it('tidak bertanya apa-apa kalau promonya memang potong otomatis', async () => {
  await render(true);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  expect(kotak().checked).toBe(true);
  expect(kirim()).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
});

// Yang benar-benar menyimpan promo adalah form action React, bukan submit
// bawaan browser. preventDefault() saja tidak menahannya — penyadapnya harus
// duduk di fase capture elemen <form> dan memutus perjalanan event ke akar.
it('menahan form action React, bukan cuma submit bawaan browser', async () => {
  const simpan = vi.fn();
  await act(async () => root.render(<form action={simpan}><AutoApplyField /><button type="submit">Simpan</button></form>));
  form = host.querySelector('form')!;
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await act(async () => { host.querySelector('button')!.click(); });
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(simpan).not.toHaveBeenCalled();

  confirm.mockReturnValue(true);
  await act(async () => { host.querySelector('button')!.click(); });
  expect(simpan).toHaveBeenCalledTimes(1);
});

it('mengikuti kotak centang yang baru diubah, bukan nilai awalnya', async () => {
  await render(true);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await act(async () => { kotak().click(); });
  expect(kirim()).toBe(false);
  expect(confirm).toHaveBeenCalledTimes(1);
});
