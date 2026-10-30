// @vitest-environment jsdom
//
// RS-1: riwayat bersama hasil impor tidak tampil di halaman pasien saat cabang aktif dipilih. Setelah
// impor, layar impor menampilkan "Periksa hasil impor" yang membaca jejak tersimpan/sudah ada lewat
// server action baca-saja. Server tiruan; perilaku database diuji di harness Postgres RLS.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RekamMedisImporRow } from '@/lib/impor-rekam-medis';

const fixture = vi.hoisted(() => ({
  periksa: [] as string[][],
  jawabPeriksa: null as null | { ok: boolean; message: string; diminta: number; rows: unknown[] },
}));

const baris = (nomor: number): RekamMedisImporRow => ({
  source_key: `wowo-test::periksa-${nomor}`, source_file: 'Fiktif.xlsx', source_sheet: String(nomor), record_no: null,
  record_date: '2026-01-15', patient_name: `Pasien fiktif ${nomor}`, owner_name: `Pemilik fiktif ${nomor}`, phone: '08000000001',
  address: null, species: null, breed: null, gender: null, dob: null, doctor: null, note: null,
  anamnesis: 'Anamnesis fiktif', clinical_findings: null, diagnosis: null, therapy: null, warning: [],
});

vi.mock('@/app/(app)/klinik/rekam-medis/impor/actions', () => ({
  // Baris 3 ditahan database: tidak ikut diperiksa.
  prosesPotonganImporRekamMedis: async (rows: RekamMedisImporRow[]) => ({
    ok: true, message: 'ok', tersimpan: 1, sudah_ada: 1, dilewati: 0,
    ditahan: [{ source_key: rows[2].source_key, source_file: 'Fiktif.xlsx', source_sheet: '3', reason: 'Jejak sumber bentrok' }],
    perlu_keputusan: [], kunci_tersimpan: [rows[0].source_key, rows[1].source_key],
  }),
  periksaHasilImporRekamMedis: async (keys: string[]) => {
    fixture.periksa.push(keys);
    return fixture.jawabPeriksa;
  },
}));

vi.mock('@/lib/impor-rekam-medis-pengurai', () => ({
  buatPenguraiKartuMedis: () => ({
    diWorker: true,
    async urai() { return { rows: [baris(1), baris(2), baris(3)], held: [], ignored_sheets: 0 }; },
    tutup() {},
  }),
}));

import { RekamMedisImportForm } from '@/app/(app)/klinik/rekam-medis/impor/RekamMedisImportForm';

let root: Root | undefined;
let host: HTMLDivElement;

function kartu(nama: string, folder: string) {
  const file = new File(['fiktif'], nama, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  Object.defineProperty(file, 'webkitRelativePath', { value: `akar/${folder}/${nama}` });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('fiktif').buffer });
  return file;
}

const tombol = (pola: RegExp) => [...host.querySelectorAll('button')].find((item) => pola.test(item.textContent ?? ''));

async function tunggu(selesai: () => boolean) {
  for (let putaran = 0; putaran < 2_000; putaran += 1) {
    await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
    if (selesai()) return;
  }
  throw new Error('Kondisi tidak tercapai dalam batas waktu tes.');
}

async function imporSatuFolder() {
  await act(async () => root!.render(<RekamMedisImportForm />));
  await act(async () => {
    const unggah = host.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(unggah, 'files', { value: [kartu('Fiktif.xlsx', 'Pemilik fiktif - 08000000001')], configurable: true });
    unggah.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(tombol(/periksa/i)).toBeUndefined();
  await act(async () => { host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click(); });
  await act(async () => { tombol(/mulai impor/i)!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await tunggu(() => /selesai/.test(host.querySelector('[role=status]')?.textContent ?? ''));
}

beforeEach(() => {
  fixture.periksa = [];
  fixture.jawabPeriksa = null;
  Object.defineProperty(window, 'localStorage', { value: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 }, configurable: true, writable: true });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = undefined;
});

it('setelah impor, Periksa hasil membaca jejak tersimpan/sudah ada saja dan menampilkan isinya', async () => {
  fixture.jawabPeriksa = {
    ok: true, message: '2 dari 2 riwayat ditemukan di riwayat bersama.', diminta: 2,
    rows: [
      { kunci: 'wowo-test::periksa-1', visit_id: 'k1', jejak_tersimpan: 'wowo-test::periksa-1', tanggal: '2026-01-14T17:00:00+00:00', pemilik: 'Pemilik fiktif 1', hewan: 'Pasien fiktif 1', dokter: null, keluhan: null, diagnosis: 'Diagnosis fiktif satu', anamnesis: null, gejala_klinis: null, terapi: null },
      { kunci: 'wowo-test::periksa-2', visit_id: 'k2', jejak_tersimpan: 'wowo-test::periksa-2', tanggal: '2026-01-14T17:00:00+00:00', pemilik: 'Pemilik fiktif 2', hewan: 'Pasien fiktif 2', dokter: null, keluhan: null, diagnosis: null, anamnesis: 'Anamnesis fiktif dua', gejala_klinis: null, terapi: null },
    ],
  };
  await imporSatuFolder();
  const periksa = tombol(/periksa 2 riwayat terakhir/i);
  expect(periksa).toBeTruthy();

  await act(async () => { periksa!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await tunggu(() => host.textContent!.includes('2 dari 2 riwayat ditemukan'));

  expect(fixture.periksa).toEqual([['wowo-test::periksa-1', 'wowo-test::periksa-2']]);
  const teks = host.textContent ?? '';
  expect(teks).toContain('Pemilik fiktif 1');
  expect(teks).toContain('Diagnosis fiktif satu');
  expect(teks).toContain('Anamnesis fiktif dua');
  expect(teks).toContain('15/1/2026');
});

it('penolakan database ditampilkan sebagai pesan, bukan tabel kosong yang menyesatkan', async () => {
  fixture.jawabPeriksa = { ok: false, message: 'Hanya OWNER/ADMIN aktif yang boleh mengimpor rekam medis', diminta: 0, rows: [] };
  await imporSatuFolder();
  await act(async () => { tombol(/periksa 2 riwayat terakhir/i)!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await tunggu(() => host.textContent!.includes('Hanya OWNER/ADMIN aktif'));
  expect(host.querySelectorAll('table').length).toBe(1); // hanya tabel riwayat ditahan
});
