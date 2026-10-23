// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/app/(app)/klinik/rekam-medis/impor/actions', () => ({
  previewImporRekamMedis: async () => ({ ok: true, phase: 'preview', message: 'Fictional preview', ignored_sheets: 0, held: [],
    rows: [{ source_key: 'source', owner_name: 'Fictional owner', phone: '080000000001', patient_name: 'Fictional cat', record_date: '2026-10-23', source_file: 'Fictional.xlsx', source_sheet: '20261023', warning: [] }],
    clarifications: [{ source_key: 'source', source_file: 'Fictional.xlsx', source_sheet: '20261023', owner_name: 'Fictional owner', patient_name: 'Fictional cat', phone: '080000000001', candidates: [
      { customer_id: 'owner', customer_name: 'Fictional owner', customer_phone: '080000000001', pet_name: 'Fictional cat', pet_id: 'pet-reference-one' },
      { customer_id: 'owner', customer_name: 'Fictional owner', customer_phone: '080000000001', pet_name: 'Fictional  cat', pet_id: 'pet-reference-two' },
    ] }],
  }), simpanBatchImporRekamMedis: async () => ({ ok: false }),
}));
import { RekamMedisImportForm } from '@/app/(app)/klinik/rekam-medis/impor/RekamMedisImportForm';
let root: Root | undefined, host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = undefined; });
it('distinguishes same-name patient candidates before the user chooses a destination', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<RekamMedisImportForm />));
  await act(async () => { const upload = host.querySelector<HTMLInputElement>('input[type=file]')!; Object.defineProperty(upload, 'files', { value: [new File(['fictional'], 'Fictional.xlsx')] }); upload.dispatchEvent(new Event('change', { bubbles: true })); });
  const preview = [...host.querySelectorAll('button')].find(b => /cek|baca/i.test(b.textContent ?? ''))!;
  await act(async () => preview.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const options = [...host.querySelectorAll('option')].filter(o => o.value.includes('pet-reference'));
  expect(options).toHaveLength(2); expect(options[0].textContent).not.toBe(options[1].textContent);
  expect(options[0].textContent).toContain('pet-reference-one'); expect(options[1].textContent).toContain('pet-reference-two');
});
