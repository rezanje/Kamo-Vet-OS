// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { EmployeeOccupationField } from '../EmployeeOccupationField';
import { employeeOccupationInput } from '@/lib/employee-occupation';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it('offers explicit occupations while preserving a legacy job until the user changes it', async () => {
  const host = document.createElement('form'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<EmployeeOccupationField value="PCA" />));
    const select = host.querySelector('select')!;
    expect([...select.options].map(option => option.value)).toEqual(['other', 'Dokter', 'Paramedis', 'Groomer']);
    expect(employeeOccupationInput(new FormData(host))).toBe('PCA');
    await act(async () => { select.value = 'Paramedis'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(employeeOccupationInput(new FormData(host))).toBe('Paramedis');
    expect(host.querySelector('[name="jabatan"]')).toBeNull();
    await act(async () => { select.value = 'other'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(employeeOccupationInput(new FormData(host))).toBe('PCA');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
