// @vitest-environment jsdom
//
// Regresi "Coba lagi" di tab yang sama (review independen PR #333): bila semua percobaan kirim
// gagal SEBELUM server menyimpan, atau baru sebagian kiriman potongan yang tersimpan, tombol
// Coba lagi wajib mengirim semua riwayat yang belum tersimpan -- bukan menganggapnya salinan
// lalu mencatat foldernya selesai. Server tiruan menyimpan per jejak sumber seperti RPC massal.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RekamMedisImporRow } from '@/lib/impor-rekam-medis';

const fixture = vi.hoisted(() => ({
  barisPerBerkas: 3,
  /** Jumlah panggilan berikutnya yang gagal sebelum apa pun tersimpan. */
  gagalBerikut: 0,
  /** Gagal mulai panggilan ke-n (1-based); 0 = tidak dipakai. */
  gagalMulaiPanggilan: 0,
  /** Server sudah menyimpan, tetapi jawabannya hilang di jalan (gagal SESUDAH commit). */
  gagalSesudahSimpan: false,
  panggilan: [] as string[][],
  simpanan: new Map<string, number>(),
  urai: 0,
}));

const baris = (nomor: number): RekamMedisImporRow => ({
  source_key: `wowo-test::retry-${nomor}`, source_file: 'Fiktif.xlsx', source_sheet: String(nomor), record_no: null,
  record_date: '2026-01-15', patient_name: `Pasien fiktif ${nomor}`, owner_name: `Pemilik fiktif ${nomor}`, phone: '08000000001',
  address: null, species: null, breed: null, gender: null, dob: null, doctor: null, note: null,
  anamnesis: 'Anamnesis fiktif', clinical_findings: null, diagnosis: null, therapy: null, warning: [],
});

vi.mock('@/app/(app)/klinik/rekam-medis/impor/actions', () => ({
  prosesPotonganImporRekamMedis: async (rows: RekamMedisImporRow[]) => {
    fixture.panggilan.push(rows.map((row) => row.source_key));
    const ke = fixture.panggilan.length;
    if (fixture.gagalMulaiPanggilan && ke >= fixture.gagalMulaiPanggilan && fixture.gagalBerikut > 0) {
      fixture.gagalBerikut -= 1;
      return { ok: false, message: 'Failed to fetch', tersimpan: 0, sudah_ada: 0, dilewati: 0, ditahan: [], perlu_keputusan: [] };
    }
    let tersimpan = 0;
    let sudahAda = 0;
    for (const row of rows) {
      // Seperti RPC massal: jejak yang sudah tersimpan (isi identik) dijawab sudah_ada, tidak ditulis lagi.
      if (fixture.simpanan.has(row.source_key)) sudahAda += 1;
      else {
        tersimpan += 1;
        fixture.simpanan.set(row.source_key, 1);
      }
    }
    if (fixture.gagalSesudahSimpan) {
      fixture.gagalSesudahSimpan = false;
      fixture.gagalBerikut = 3;
      fixture.gagalMulaiPanggilan = ke + 1;
      return { ok: false, message: 'Failed to fetch', tersimpan: 0, sudah_ada: 0, dilewati: 0, ditahan: [], perlu_keputusan: [] };
    }
    return { ok: true, message: 'ok', tersimpan, sudah_ada: sudahAda, dilewati: 0, ditahan: [], perlu_keputusan: [] };
  },
}));

vi.mock('@/lib/impor-rekam-medis-pengurai', () => ({
  buatPenguraiKartuMedis: () => ({
    diWorker: true,
    // Berkas yang sama selalu menghasilkan riwayat yang sama, seperti pengurai sungguhan.
    async urai() {
      fixture.urai += 1;
      return { rows: Array.from({ length: fixture.barisPerBerkas }, (_, index) => baris(index + 1)), held: [], ignored_sheets: 0 };
    },
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
const status = () => host.querySelector('[role=status]')!.textContent ?? '';

const berhenti = () => Boolean(tombol(/coba lagi/i)) || /selesai/.test(host.querySelector('[role=status]')?.textContent ?? '');

/**
 * Majukan jam tiruan (jeda kirim ulang 800+1600+3200 ms) sampai impor berhenti -- gagal (tombol
 * Coba lagi) atau selesai. Sidik isi (Web Crypto) selesai di luar antrean mikro, jadi tiap putaran
 * juga memberi giliran event loop sungguhan; batas putaran mencegah tes menggantung.
 */
async function tunggu() {
  for (let putaran = 0; putaran < 4_000; putaran += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      await new Promise((resolve) => setImmediate(resolve));
    });
    if (berhenti()) return;
  }
  throw new Error('Impor tidak berhenti (gagal/selesai) dalam batas waktu tes.');
}

async function klik(pola: RegExp) {
  await act(async () => { tombol(pola)!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await tunggu();
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
    isi,
  } as Storage & { isi: Map<string, string> };
}

async function pilihDanMulai() {
  await act(async () => root!.render(<RekamMedisImportForm />));
  await act(async () => {
    const unggah = host.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(unggah, 'files', { value: [kartu('Fiktif.xlsx', 'Pemilik fiktif - 08000000001')], configurable: true });
    unggah.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => { host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click(); });
  await klik(/mulai impor/i);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  fixture.barisPerBerkas = 3;
  fixture.gagalBerikut = 0;
  fixture.gagalMulaiPanggilan = 0;
  fixture.gagalSesudahSimpan = false;
  fixture.panggilan = [];
  fixture.simpanan = new Map();
  fixture.urai = 0;
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
  vi.useRealTimers();
});

it('Coba lagi setelah 4 percobaan kirim gagal sebelum tersimpan mengirim ulang dan menyimpan semua riwayat', async () => {
  fixture.gagalMulaiPanggilan = 1;
  fixture.gagalBerikut = 4;
  await pilihDanMulai();

  expect(fixture.panggilan).toHaveLength(4);
  expect(fixture.simpanan.size).toBe(0);
  expect(tombol(/coba lagi/i)).toBeTruthy();
  // Folder yang gagal tidak boleh tercatat selesai.
  const titik = (window.localStorage as Storage & { isi: Map<string, string> }).isi;
  expect([...titik.values()].join('')).not.toContain('Pemilik fiktif');

  await klik(/coba lagi/i);

  expect(fixture.panggilan).toHaveLength(5);
  expect(fixture.panggilan[4]).toEqual(['wowo-test::retry-1', 'wowo-test::retry-2', 'wowo-test::retry-3']);
  expect([...fixture.simpanan.keys()].sort()).toEqual(['wowo-test::retry-1', 'wowo-test::retry-2', 'wowo-test::retry-3']);
  expect(status()).toContain('3 tersimpan');
  expect(status()).toContain(' 0 ditahan');
  expect(status()).toContain('selesai');
});

it('Coba lagi setelah kiriman pertama (150 baris) sukses dan kiriman berikutnya gagal hanya mengirim sisanya', async () => {
  fixture.barisPerBerkas = 200;
  fixture.gagalMulaiPanggilan = 2;
  fixture.gagalBerikut = 4;
  await pilihDanMulai();

  expect(fixture.panggilan.map((kiriman) => kiriman.length)).toEqual([150, 50, 50, 50, 50]);
  expect(fixture.simpanan.size).toBe(150);
  expect(tombol(/coba lagi/i)).toBeTruthy();

  await klik(/coba lagi/i);

  const sesudah = fixture.panggilan.slice(5);
  expect(sesudah.map((kiriman) => kiriman.length)).toEqual([50]);
  expect(sesudah[0][0]).toBe('wowo-test::retry-151');
  expect(fixture.simpanan.size).toBe(200);
  // Riwayat yang sudah sukses di kiriman pertama tidak pernah dikirim lagi.
  const kaliDikirim = new Map<string, number>();
  for (const key of fixture.panggilan.flat()) kaliDikirim.set(key, (kaliDikirim.get(key) ?? 0) + 1);
  expect(Array.from({ length: 150 }, (_, index) => kaliDikirim.get(`wowo-test::retry-${index + 1}`))).toEqual(Array(150).fill(1));
  expect(status()).toContain('200 tersimpan');
  expect(status()).toContain(' 0 sudah ada');
  expect(status()).toContain(' 0 ditahan');
  expect(status()).toContain('selesai');
});

it('Coba lagi setelah server menyimpan tetapi jawabannya hilang: dikirim ulang, dijawab sudah ada, tidak ganda', async () => {
  fixture.gagalSesudahSimpan = true;
  await pilihDanMulai();

  expect(fixture.panggilan).toHaveLength(4);
  expect(fixture.simpanan.size).toBe(3);
  expect(tombol(/coba lagi/i)).toBeTruthy();

  await klik(/coba lagi/i);

  expect(fixture.panggilan).toHaveLength(5);
  expect(fixture.simpanan.size).toBe(3);
  expect(status()).toContain('3 sudah ada');
  expect(status()).toContain(' 0 ditahan');
  expect(status()).toContain('selesai');
});
