// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const s = vi.hoisted(() => ({ qty: 1, calls: 0 }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('@/components/LocalTransactionDraft', () => ({ PreservedForm: ({ children }: { children: ReactNode }) => <form>{children}</form>, LocalTransactionDraft: () => null }));
vi.mock('@/app/(app)/pos/opname/actions', () => ({
  kunciBaris: async () => { s.calls++; return { ok: true, qtyFisik: s.qty }; },
  bukaKunci: async () => ({ ok: true }), periksaJumlahTakWajar: async () => ({ ok: true, janggal: [] }), muatUlangStok: async () => ({ ok: true }), simpanHasil: async () => {},
}));
import { HitungForm } from '@/app/kasir/opname/[id]/HitungForm';
let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  s.qty = 1; s.calls = 0; Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<HitungForm orderId="order" rows={[{ item_id: 'item', code: 'ITEM', name: 'Fictional item', unit: 'PCS', kategori: 'Fictional', sell_price: 0 }]} terkunci={{}} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function fill(value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('tbody input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function lock() { await act(async () => [...host.querySelectorAll('tbody button')].find(b => b.textContent?.trim() === 'Kunci')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }
it('shows the authoritative stored count after a duplicate lock, rather than an unsaved newer input', async () => {
  await fill('2'); await lock(); expect(host.querySelector<HTMLTableRowElement>('tbody tr')?.cells[4]?.textContent).toBe('1PCS');
  expect(host.textContent).toContain('Buka untuk mengubah');
  expect(host.querySelector<HTMLInputElement>('input[name=fisik]')?.value ?? host.querySelector<HTMLInputElement>('input[name=fisik_json]')?.value ?? host.innerHTML).not.toContain('"item":2');
});
it('shows each product unit big beside its physical count input, even before any count is entered', async () => {
  const rows = ['PCS', '1kg', '0.5kg', ' '].map((unit, index) => ({
    item_id: String(index), code: `SKU-${index}`, name: `Product ${index}`, unit, kategori: 'Fictional', sell_price: 0,
  }));
  await act(async () => root.render(<HitungForm orderId="order" rows={rows} terkunci={{}} />));

  expect(host.querySelector('thead th:nth-child(5)')?.textContent).toBe('Jumlah fisik & satuan');
  const countRows = [...host.querySelectorAll<HTMLTableRowElement>('tbody tr')];
  expect(countRows.map(row => row.cells[4].querySelector('[data-satuan-besar]')?.textContent)).toEqual(['PCS', '1kg', '0.5kg', 'satuan?']);
  expect(countRows.map(row => row.cells[4].querySelector('input')?.value)).toEqual(['', '', '', '']);
});
it('does not turn a negative count into a confirmed zero', async () => {
  await fill('-1'); await lock(); expect(s.calls).toBe(0); expect(host.textContent).toContain('jumlah fisik'); expect(host.querySelector('tbody')!.textContent).not.toContain('Buka');
});
it('reopening a locked count tells staff to enter the shelf quantity now, not the opening stock', async () => {
  await fill('11'); s.qty = 11; await lock();
  await act(async () => [...host.querySelectorAll('tbody button')].find(b => b.textContent?.trim() === 'Buka')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(host.textContent).toContain('Hitung ulang Fictional item');
  expect(host.textContent).toContain('rak SEKARANG');
  expect(host.textContent).toContain('jangan isi stok awal opname');
});
