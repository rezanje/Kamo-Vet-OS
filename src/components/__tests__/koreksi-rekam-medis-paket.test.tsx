// @vitest-environment jsdom
// Anisa 7 Nov: dokter mengoreksi rekam medis (menambah diagnosis) sesudah memilih paket
// "Kimia Darah Lengkap"; koreksi menyimpan ulang isi paket TANPA asal paket, sehingga kasir
// melihat isi paket berceceran. Keranjang koreksi harus memuat dan mengirim asal paketnya.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/app/(app)/klinik/rekam-medis/[visitId]/actions', () => ({ simpanRekamMedis: vi.fn(), koreksiRekamMedis: vi.fn(), koreksiRekamMedisLengkap: vi.fn() }));
vi.mock('@/components/PetPhotoUpload', () => ({ PetPhotoUpload: () => null }));
vi.mock('@/components/PenunjangUpload', () => ({ PenunjangUpload: () => null }));
import { RekamForm } from '@/app/(app)/klinik/rekam-medis/[visitId]/RekamForm';
import { savedPackageOrigin, type ClinicalCorrection } from '@/lib/clinical-correction';
import { clinicPackageOriginInput } from '@/lib/clinic-package-origin';

const PAKET = '11111111-1111-4111-8111-111111111111';
const KIMIA = '22222222-2222-4222-8222-222222222222';
const SPUIT = '33333333-3333-4333-8333-333333333333';
const OBAT = '44444444-4444-4444-8444-444444444444';

const prescriptions: ClinicalCorrection['prescriptions'] = [
  { id: 'rx-kimia', item_id: KIMIA, nama_obat: 'Kimia Darah Fiktif', qty: 1, harga: 799355, satuan: 'PCS', jenis: 'obat', aturan_pakai: null,
    package_item_id: PAKET, package_qty: '1.0000', package: { name: 'Paket Kimia Fiktif' } },
  { id: 'rx-obat', item_id: OBAT, nama_obat: 'Obat Biasa Fiktif', qty: 2, harga: 5000, satuan: 'PCS', jenis: 'obat', aturan_pakai: null,
    package_item_id: null, package_qty: null, package: null },
  { id: 'rx-spuit', item_id: SPUIT, nama_obat: 'Spuit Fiktif', qty: 1, harga: 645, satuan: 'PCS', jenis: 'obat', aturan_pakai: null,
    package_item_id: PAKET, package_qty: 1, package: [{ name: 'Paket Kimia Fiktif' }] },
];

describe('asal paket tersimpan → keranjang koreksi', () => {
  it('membaca paket dari relasi objek maupun larik, qty numerik atau teks', () => {
    expect(savedPackageOrigin(prescriptions[0])).toEqual({ paket_id: PAKET, paket_nama: 'Paket Kimia Fiktif', paket_qty: 1 });
    expect(savedPackageOrigin(prescriptions[2])).toEqual({ paket_id: PAKET, paket_nama: 'Paket Kimia Fiktif', paket_qty: 1 });
  });
  it('baris biasa, racikan, dan jumlah paket rusak tetap baris biasa', () => {
    expect(savedPackageOrigin(prescriptions[1])).toEqual({});
    expect(savedPackageOrigin({ ...prescriptions[0], compound_recipe_id: 'r' })).toEqual({});
    expect(savedPackageOrigin({ ...prescriptions[0], package_qty: 0 })).toEqual({});
    expect(savedPackageOrigin({ ...prescriptions[0], package_qty: 1.5 })).toEqual({});
  });
});

it('koreksi rekam medis menampilkan satu baris paket dan mengirim ulang asal paket tiap isinya', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<RekamForm visitId="visit" petId="pet" requestKey="koreksi-paket" draftUserId="doctor" items={[]} racikanItems={[]} bahanItems={[]} jasaItems={[]} tindakanItems={[]} katalogRacikan={[]} bolehManual currentWeight={3} dokterOpsi={[]} providerOpsi={[]}
      patient={{ name: 'Fiktif', species: 'Kucing', breed: null, noRM: 'F', tglPeriksa: 'F', dokter: 'F', dokterId: null, providerId: null, owner: 'Fiktif', phone: '080', address: '', tier: '', keluhan: 'F', photo: null }}
      correction={{ fullEdit: true, recordId: 'record', revision: 0, anamnesis: 'Saved', diagnosis: null, therapy: null, suhu: null, berat: 3, gejala_klinis: null, hasil_penunjang: null, penunjang_urls: [], follow_up: null, catatan_resep: null, prescriptions, compounds: [] }} />));
    // Satu baris paket (bukan isi berceceran), isi kecil tanpa ubah harga per baris.
    const paket = host.querySelectorAll(`tr[data-paket="${PAKET}"]`);
    expect(paket).toHaveLength(1);
    expect(paket[0].textContent).toContain('Paket Kimia Fiktif');
    expect(host.querySelector('[aria-label="Jumlah Kimia Darah Fiktif"]')).toBeNull();
    expect(host.querySelector('[aria-label="Jumlah Obat Biasa Fiktif"]')).not.toBeNull();

    const rows = JSON.parse((host.querySelector('[name="resep"]') as HTMLInputElement).value);
    expect(rows).toMatchObject([
      { prescription_item_id: 'rx-kimia', paket_id: PAKET, paket_qty: 1 },
      { prescription_item_id: 'rx-obat' },
      { prescription_item_id: 'rx-spuit', paket_id: PAKET, paket_qty: 1 },
    ]);
    expect(rows[1].paket_id).toBeUndefined();
    // Yang dikirim server koreksi: asal paket tetap ada (sebelumnya terhapus jadi null).
    expect(rows.map(clinicPackageOriginInput)).toEqual([
      { package_item_id: PAKET, package_qty: 1 }, {}, { package_item_id: PAKET, package_qty: 1 },
    ]);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
