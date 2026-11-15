// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/app/(app)/klinik/rekam-medis/[visitId]/actions', () => ({ simpanRekamMedis: vi.fn(), koreksiRekamMedis: vi.fn(), koreksiRekamMedisLengkap: vi.fn() }));
vi.mock('@/components/PetPhotoUpload', () => ({ PetPhotoUpload: () => null }));
vi.mock('@/components/PenunjangUpload', () => ({ PenunjangUpload: () => null }));
import { RekamForm } from '@/app/(app)/klinik/rekam-medis/[visitId]/RekamForm';

const hosts: { host: HTMLElement; root: ReturnType<typeof createRoot> }[] = [];
afterEach(async () => { for (const h of hosts.splice(0)) { await act(async () => h.root.unmount()); h.host.remove(); } });

async function render(opts: { species?: string; berat: number | null; fullEdit?: boolean; edit?: boolean }) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); hosts.push({ host, root });
  const correction = opts.edit === false ? undefined : {
    fullEdit: opts.fullEdit ?? true, recordId: 'record', revision: 2, anamnesis: 'Req vaksin, groom BB 1kg', diagnosis: null, therapy: null, suhu: 39.6,
    berat: opts.berat, gejala_klinis: null, hasil_penunjang: null, penunjang_urls: [], follow_up: null, catatan_resep: null, prescriptions: [],
  };
  await act(async () => root.render(<RekamForm visitId="visit" petId="pet" requestKey="k" draftUserId="user" items={[]} racikanItems={[]} bahanItems={[]} jasaItems={[]} tindakanItems={[]} katalogRacikan={[]} bolehManual currentWeight={9} dokterOpsi={[]} providerOpsi={[]}
    patient={{ name: 'olli', species: opts.species ?? 'Kucing', breed: null, noRM: 'F', tglPeriksa: 'F', dokter: 'F', dokterId: null, providerId: null, owner: 'F', phone: '080', address: '', tier: '', keluhan: 'grooming', photo: null }}
    correction={correction} />));
  return host;
}
const berat = (host: HTMLElement) => host.querySelector<HTMLInputElement>('[name="berat"]')!;

it('mode koreksi penuh: Berat Badan bisa diedit (tidak readOnly), terisi berat rekam (2,6), langkah 0,01', async () => {
  const host = await render({ berat: 2.6 });
  expect(berat(host).readOnly).toBe(false);
  expect(berat(host).value).toBe('2.6');
  expect(berat(host).step).toBe('0.01');
  expect(berat(host).required).toBe(true);
});
it('batas spesies tetap berlaku (Kucing 15) dan satu baris catatan profil tampil', async () => {
  const host = await render({ berat: 2.6 });
  expect(berat(host).max).toBe('15');
  expect(host.querySelector('[data-berat-catatan]')?.textContent).toContain('catatan berat terbaru');
});
it('berat tersimpan yang sudah melewati batas wajar tidak mengunci form (tanpa max)', async () => {
  const host = await render({ berat: 20 });
  expect(berat(host).max).toBe('');
});
it('rekam tanpa berat: boleh kosong; pengisian tetap diizinkan', async () => {
  const host = await render({ berat: null });
  expect(berat(host).required).toBe(false);
  expect(berat(host).readOnly).toBe(false);
});
it('koreksi lama (bukan koreksi penuh) tetap read-only karena aksinya tidak mengirim berat', async () => {
  const host = await render({ berat: 2.6, fullEdit: false });
  expect(berat(host).readOnly).toBe(true);
  expect(host.querySelector('[data-berat-catatan]')).toBeNull();
});
it('pemeriksaan pertama (bukan koreksi): berat profil jadi isian awal, tanpa catatan koreksi', async () => {
  const host = await render({ berat: null, edit: false });
  expect(berat(host).value).toBe('9');
  expect(berat(host).step).toBe('0.1');
  expect(berat(host).readOnly).toBe(false);
  expect(host.querySelector('[data-berat-catatan]')).toBeNull();
});
it('alasan koreksi tetap wajib', async () => {
  const host = await render({ berat: 2.6 });
  expect(host.querySelector<HTMLTextAreaElement>('[name="correction_reason"]')!.required).toBe(true);
});
