// @vitest-environment jsdom
//
// Regresi titik simpan (review independen PR #333): folder yang sudah tercatat selesai
// dilewati tanpa dibaca ulang. Bila kartu di folder itu diubah setelah impor terputus dan
// ukurannya kebetulan sama, folder itu tidak boleh dilewati -- isinya wajib dibaca dan
// dikirim lagi supaya database bisa membuktikan sama (sudah ada) atau menahannya (bentrok).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RekamMedisImporRow } from '@/lib/impor-rekam-medis';

const fixture = vi.hoisted(() => ({
  panggilan: [] as Array<Array<{ source_key: string; diagnosis: string | null }>>,
  /** Pesan gagal untuk kiriman yang memuat folder ini (tidak diulang otomatis). */
  gagalFolder: null as string | null,
}));

vi.mock('@/app/(app)/klinik/rekam-medis/impor/actions', () => ({
  prosesPotonganImporRekamMedis: async (rows: RekamMedisImporRow[]) => {
    fixture.panggilan.push(rows.map((row) => ({ source_key: row.source_key, diagnosis: row.diagnosis })));
    if (fixture.gagalFolder && rows.some((row) => row.source_key.startsWith(fixture.gagalFolder!))) {
      return { ok: false, message: 'Sesi berakhir; masuk ulang', tersimpan: 0, sudah_ada: 0, dilewati: 0, ditahan: [], perlu_keputusan: [] };
    }
    return { ok: true, message: 'ok', tersimpan: rows.length, sudah_ada: 0, dilewati: 0, ditahan: [], perlu_keputusan: [] };
  },
}));

vi.mock('@/lib/impor-rekam-medis-pengurai', () => ({
  buatPenguraiKartuMedis: () => ({
    diWorker: true,
    // Isi kartu = isi berkas, jadi kartu yang diubah menghasilkan diagnosis berbeda.
    async urai(berkas: Array<{ sourcePath: string; bytes: Uint8Array }>) {
      return {
        rows: berkas.map((item, index) => ({
          source_key: `${item.sourcePath}::${index}`, source_file: item.sourcePath, source_sheet: '15012026', record_no: null,
          record_date: '2026-01-15', patient_name: `Pasien ${item.sourcePath}`, owner_name: `Pemilik ${item.sourcePath}`, phone: '08000000001',
          address: null, species: null, breed: null, gender: null, dob: null, doctor: null, note: null,
          anamnesis: null, clinical_findings: null, diagnosis: new TextDecoder().decode(item.bytes), therapy: null, warning: [],
        })),
        held: [],
        ignored_sheets: 0,
      };
    },
    tutup() {},
  }),
}));

import { RekamMedisImportForm } from '@/app/(app)/klinik/rekam-medis/impor/RekamMedisImportForm';

let root: Root | undefined;
let host: HTMLDivElement;

/** Isi berbeda dengan panjang sama = ukuran berkas sama. */
function kartu(folder: string, isi: string, diubah: number) {
  const file = new File([isi], 'Kartu.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', lastModified: diubah });
  Object.defineProperty(file, 'webkitRelativePath', { value: `akar/${folder}/Kartu.xlsx` });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(isi).buffer });
  return file;
}

const tombol = (pola: RegExp) => [...host.querySelectorAll('button')].find((item) => pola.test(item.textContent ?? ''));

/** Tunggu sampai impor berhenti (selesai atau tombol Coba lagi); sidik isi berjalan di luar antrean mikro. */
async function tenang(batasMs = 3_000) {
  const mulai = Date.now();
  do {
    await act(async () => { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 5)); });
  } while (!berhenti() && Date.now() - mulai < batasMs);
}

const berhenti = () => [...host.querySelectorAll('button')].some((item) => /coba lagi/i.test(item.textContent ?? ''))
  || /selesai/.test(host.querySelector('[role=status]')?.textContent ?? '');

async function pilihDanMulai(berkas: File[]) {
  await act(async () => {
    const unggah = host.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(unggah, 'files', { value: berkas, configurable: true });
    unggah.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const centang = host.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  if (!centang.checked) await act(async () => { centang.click(); });
  await act(async () => { tombol(/mulai impor/i)!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await tenang();
}

function penyimpanTiruan() {
  const isi = new Map<string, string>();
  return {
    get length() { return isi.size; },
    clear: () => isi.clear(),
    getItem: (key: string) => isi.get(key) ?? null,
    setItem: (key: string, value: string) => void isi.set(key, String(value)),
    removeItem: (key: string) => void isi.delete(key),
    key: (index: number) => [...isi.keys()][index] ?? null,
  } as Storage;
}

beforeEach(() => {
  fixture.panggilan = [];
  fixture.gagalFolder = null;
  Object.defineProperty(window, 'localStorage', { value: penyimpanTiruan(), configurable: true, writable: true });
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

const terkirim = () => fixture.panggilan.flat();

it('folder selesai yang kartunya berubah (ukuran sama) setelah terputus dibaca dan dikirim ulang', async () => {
  // Sesi 1: folder A tuntas, folder B gagal -> titik simpan mencatat A selesai.
  fixture.gagalFolder = 'akar/B';
  await act(async () => root!.render(<RekamMedisImportForm />));
  await pilihDanMulai([kartu('A', 'Diagnosis lama', 1_000), kartu('B', 'Diagnosis B', 1_000)]);
  expect(terkirim().map((row) => row.diagnosis)).toEqual(['Diagnosis lama', 'Diagnosis B']);
  expect(tombol(/coba lagi/i)).toBeTruthy();

  // Sesi 2 (tab baru): kartu A diedit, panjang isi sama, waktu ubah berbeda.
  await act(async () => root!.unmount());
  root = createRoot(host);
  fixture.panggilan = [];
  fixture.gagalFolder = null;
  await act(async () => root!.render(<RekamMedisImportForm />));
  await pilihDanMulai([kartu('A', 'Diagnosis baru', 2_000), kartu('B', 'Diagnosis B', 1_000)]);

  expect(terkirim().map((row) => row.diagnosis)).toContain('Diagnosis baru');
});

it('folder selesai yang tidak berubah tetap dilewati saat dilanjutkan', async () => {
  fixture.gagalFolder = 'akar/B';
  await act(async () => root!.render(<RekamMedisImportForm />));
  await pilihDanMulai([kartu('A', 'Diagnosis lama', 1_000), kartu('B', 'Diagnosis B', 1_000)]);

  await act(async () => root!.unmount());
  root = createRoot(host);
  fixture.panggilan = [];
  fixture.gagalFolder = null;
  await act(async () => root!.render(<RekamMedisImportForm />));
  await pilihDanMulai([kartu('A', 'Diagnosis lama', 1_000), kartu('B', 'Diagnosis B', 1_000)]);

  expect(terkirim().map((row) => row.diagnosis)).toEqual(['Diagnosis B']);
});

// Isi berubah dengan ukuran DAN waktu ubah sama persis (mis. disalin dengan timestamp
// dipertahankan): metadata tidak bisa membedakannya, jadi folder selesai dibuktikan lewat sidik
// ISI (SHA-256 byte berkas) sebelum dilewati.
it('isi berubah dengan ukuran DAN waktu ubah sama tetap dibaca dan dikirim ulang (sidik isi)', async () => {
  fixture.gagalFolder = 'akar/B';
  await act(async () => root!.render(<RekamMedisImportForm />));
  await pilihDanMulai([kartu('A', 'Diagnosis lama', 1_000), kartu('B', 'Diagnosis B', 1_000)]);

  await act(async () => root!.unmount());
  root = createRoot(host);
  fixture.panggilan = [];
  fixture.gagalFolder = null;
  await act(async () => root!.render(<RekamMedisImportForm />));
  await pilihDanMulai([kartu('A', 'Diagnosis baru', 1_000), kartu('B', 'Diagnosis B', 1_000)]);

  expect(terkirim().map((row) => row.diagnosis)).toContain('Diagnosis baru');
});
