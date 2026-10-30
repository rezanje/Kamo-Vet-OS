// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RekamMedisImporRow } from '@/lib/impor-rekam-medis';

const fixture = vi.hoisted(() => ({
  kiriman: [] as RekamMedisImporRow[][],
  jawaban: [] as Array<Record<string, unknown>>,
  potongan: [] as Array<{ berkas: number }>,
  gagalPertama: false,
}));

const baris = (ubah: Partial<RekamMedisImporRow> = {}): RekamMedisImporRow => ({
  source_key: 'source', source_file: 'Fictional.xlsx', source_sheet: '20261023', record_no: null,
  record_date: '2026-10-23', patient_name: 'Fictional cat', owner_name: 'Fictional owner', phone: '080000000001',
  address: null, species: null, breed: null, gender: null, dob: null, doctor: null, note: null,
  anamnesis: 'Fictional history', clinical_findings: null, diagnosis: null, therapy: null, warning: [], ...ubah,
});

const klarifikasi = {
  source_key: 'source', source_file: 'Fictional.xlsx', source_sheet: '20261023',
  owner_name: 'Fictional owner', phone: '080000000001', patient_name: 'Fictional cat',
  candidates: [
    { customer_id: 'owner', customer_name: 'Fictional owner', customer_phone: '080000000001', pet_name: 'Fictional cat', pet_id: 'pet-reference-one' },
    { customer_id: 'owner', customer_name: 'Fictional owner', customer_phone: '080000000001', pet_name: 'Fictional  cat', pet_id: 'pet-reference-two' },
  ],
};

vi.mock('@/app/(app)/klinik/rekam-medis/impor/actions', () => ({
  prosesPotonganImporRekamMedis: async (rows: RekamMedisImporRow[]) => {
    fixture.kiriman.push(rows);
    if (fixture.gagalPertama && fixture.kiriman.length === 1) {
      return { ok: false, message: 'Failed to fetch', tersimpan: 0, sudah_ada: 0, dilewati: 0, ditahan: [], perlu_keputusan: [], kunci_tersimpan: [] };
    }
    return fixture.jawaban.shift() ?? { ok: true, message: 'ok', tersimpan: rows.length, sudah_ada: 0, dilewati: 0, ditahan: [], perlu_keputusan: [], kunci_tersimpan: [] };
  },
}));

vi.mock('@/lib/impor-rekam-medis-pengurai', () => ({
  buatPenguraiKartuMedis: () => ({
    diWorker: true,
    async urai(berkas: unknown[]) {
      fixture.potongan.push({ berkas: berkas.length });
      const urutan = fixture.potongan.length;
      // Tiap potongan memberi riwayat pemilik berbeda supaya penyaring ganda tidak ikut bicara.
      return { rows: [baris({ source_key: `source-${urutan}`, owner_name: `Fictional owner ${urutan}` })], held: [], ignored_sheets: 0 };
    },
    tutup() {},
  }),
}));

import { RekamMedisImportForm } from '@/app/(app)/klinik/rekam-medis/impor/RekamMedisImportForm';
import { kunciTitikSimpan, sidikIsiBerkas, sidikIsiFolder, tandaRuangImpor } from '@/lib/impor-rekam-medis-aliran';
import { sumberFolderLokal } from '@/lib/impor-rekam-medis-sumber';

let root: Root | undefined;
let host: HTMLDivElement;

function kartu(nama: string, folder: string) {
  const file = new File(['fictional'], nama, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  Object.defineProperty(file, 'webkitRelativePath', { value: `akar/${folder}/${nama}` });
  // jsdom belum punya Blob#arrayBuffer; browser sungguhan punya.
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('fictional').buffer });
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
  await act(async () => { host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click(); });
  await act(async () => { tombol(/mulai impor/i)!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await tenang();
}

// jsdom di proyek ini tidak menyediakan localStorage; titik simpan diuji lewat penyimpan tiruan.
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
  fixture.kiriman = [];
  fixture.jawaban = [];
  fixture.potongan = [];
  fixture.gagalPertama = false;
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

it('distinguishes same-name patient candidates before the user chooses a destination', async () => {
  fixture.jawaban = [{ ok: true, message: 'ok', tersimpan: 0, sudah_ada: 0, dilewati: 0, ditahan: [], perlu_keputusan: [klarifikasi], kunci_tersimpan: [] }];
  await act(async () => root!.render(<RekamMedisImportForm />));
  await pilihDanMulai([kartu('Fictional.xlsx', 'Fictional owner - 080000000001')]);
  const options = [...host.querySelectorAll('option')].filter((item) => item.value.includes('pet-reference'));
  expect(options).toHaveLength(2);
  expect(options[0].textContent).not.toBe(options[1].textContent);
  expect(options[0].textContent).toContain('pet-reference-one');
  expect(options[1].textContent).toContain('pet-reference-two');
});

it('menampilkan kemajuan per folder beserta hitungan hasilnya dan tidak berhenti karena pertanyaan identitas', async () => {
  fixture.jawaban = [
    { ok: true, message: 'ok', tersimpan: 0, sudah_ada: 0, dilewati: 0, ditahan: [], perlu_keputusan: [klarifikasi], kunci_tersimpan: [] },
    { ok: true, message: 'ok', tersimpan: 1, sudah_ada: 2, dilewati: 0, ditahan: [{ source_key: 'x', source_file: 'B.xlsx', source_sheet: '1', reason: 'Tanggal wajib diisi' }], perlu_keputusan: [], kunci_tersimpan: [] },
  ];
  await act(async () => root!.render(<RekamMedisImportForm />));
  await pilihDanMulai([kartu('A.xlsx', 'Owner A - 0801'), kartu('B.xlsx', 'Owner B - 0802')]);
  const status = host.querySelector('[role=status]')!;
  expect(status.textContent).toContain('2 dari 2 folder');
  expect(status.textContent).toContain('1 tersimpan');
  expect(status.textContent).toContain('2 sudah ada');
  expect(status.textContent).toContain('1 ditahan');
  expect(status.textContent).toContain('1 perlu keputusan');
  expect(status.textContent).toContain('selesai');
  expect(host.querySelector('[role=progressbar]')!.getAttribute('aria-valuenow')).toBe('2');
  // Dua folder pemilik tidak pernah dicampur dalam satu potongan.
  expect(fixture.potongan).toEqual([{ berkas: 1 }, { berkas: 1 }]);
  expect(tombol(/unduh catatan ditahan/i)).toBeTruthy();
});

it('melewati folder yang sudah selesai saat folder yang sama dipilih ulang setelah terputus', async () => {
  await act(async () => root!.render(<RekamMedisImportForm />));
  const berkas = [kartu('A.xlsx', 'Owner A - 0801'), kartu('B.xlsx', 'Owner B - 0802')];
  // Titik simpan seperti yang ditulis tab sebelumnya: tanda ruang dari berkas yang sama dan
  // sidik ISI folder A yang sudah diimpor.
  const ruang = tandaRuangImpor('akar', await sumberFolderLokal(berkas).daftarFolder());
  const sidikA = await sidikIsiFolder([{ jalur: 'akar/Owner A - 0801/A.xlsx', sidik: await sidikIsiBerkas(new TextEncoder().encode('fictional')) }]);
  window.localStorage.setItem(
    kunciTitikSimpan(ruang),
    JSON.stringify({ selesai: { 'akar/Owner A - 0801': sidikA }, diperbarui: '2026-10-29T00:00:00.000Z' }),
  );
  await pilihDanMulai(berkas);
  expect(fixture.potongan).toHaveLength(1);
  expect(host.querySelector('[role=status]')!.textContent).toContain('2 dari 2 folder');
});

it('mencoba ulang gangguan jaringan tanpa mengirim potongan dua kali ke penyimpanan baru', async () => {
  fixture.gagalPertama = true;
  await act(async () => root!.render(<RekamMedisImportForm />));
  await pilihDanMulai([kartu('A.xlsx', 'Owner A - 0801')]);
  // Kirim ulang memakai jeda mundur sungguhan; beri waktu lebih dari jeda percobaan pertama.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1_200)); });
  await tenang();
  expect(fixture.kiriman.length).toBeGreaterThanOrEqual(2);
  expect(fixture.kiriman[0].map((row) => row.source_key)).toEqual(fixture.kiriman[1].map((row) => row.source_key));
  expect(host.querySelector('[role=status]')!.textContent).toContain('1 tersimpan');
});

it('menolak mulai sebelum persetujuan dicentang', async () => {
  await act(async () => root!.render(<RekamMedisImportForm />));
  await act(async () => {
    const unggah = host.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(unggah, 'files', { value: [kartu('A.xlsx', 'Owner A - 0801')], configurable: true });
    unggah.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(tombol(/mulai impor/i)!.disabled).toBe(true);
  expect(fixture.kiriman).toEqual([]);
});
