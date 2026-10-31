// Impor massal master data: pelanggan dan pemasok (bagan akun: lihat impor-akun.ts).
// Murni, dites di __tests__/impor-master.test.ts. Pembacaan CSV-nya di impor-csv.ts.
//
// Aturan yang sama dengan impor barang: baris bermasalah dilewati dan dilaporkan,
// tidak menggugurkan baris lain, dan master data pendukung TIDAK dibuat otomatis.

import { angka, type BarisCsv, type BarisSalah } from "./impor-csv";

export type Hasil<T> = { siap: T[]; salah: BarisSalah[] };

const teks = (v: string | undefined, batas = 200) => (v ?? "").trim().slice(0, batas);
const kosongJadiNull = (v: string) => (v ? v : null);

// ── Pelanggan ─────────────────────────────────────────────────────────────────

export const KOLOM_PELANGGAN = [
  "nama", "telp", "email", "alamat", "kategori", "pekerjaan", "sumber_info", "catatan", "npwp",
] as const;
export const WAJIB_PELANGGAN = ["nama", "telp"] as const;

export const CONTOH_PELANGGAN = [
  KOLOM_PELANGGAN.join(","),
  "Budi Santoso,081234567890,budi@email.com,Jl. Merdeka 10,Member,Wiraswasta,Instagram,,",
  "PT Anugerah Jaya,081298765432,,Jl. Sudirman 5,Umum,,Teman,,01.234.567.8-901.000",
].join("\n");

export type PelangganImpor = {
  name: string; phone: string; email: string | null; address: string | null;
  category_id: string | null; pekerjaan: string | null; sumber_info: string | null;
  catatan: string | null; npwp: string | null;
};

export type MasterPelanggan = {
  /** nama golongan (huruf kecil) → id */
  kategori: Map<string, string>;
  /** nomor HP yang sudah terdaftar, sudah dinormalkan */
  telpTerpakai: Set<string>;
};

/** 0812-3456 / +62 812 3456 disamakan supaya tidak lolos jadi pelanggan kembar. */
export function normalTelp(v: string): string {
  const digit = (v ?? "").replace(/\D/g, "");
  if (!digit) return "";
  if (digit.startsWith("62")) return "0" + digit.slice(2);
  if (digit.startsWith("0")) return digit;
  return "0" + digit;
}

export function periksaPelanggan(baris: BarisCsv[], master: MasterPelanggan): Hasil<PelangganImpor> {
  const siap: PelangganImpor[] = [];
  const salah: BarisSalah[] = [];
  const telpDiFile = new Set<string>();

  for (const b of baris) {
    const d = b.data;
    const nama = teks(d.nama, 100);
    const tolak = (pesan: string) => salah.push({ no: b.no, kode: nama || "—", pesan });

    if (!nama) { tolak("Nama pelanggan kosong"); continue; }

    const telp = normalTelp(d.telp ?? "");
    if (!telp) { tolak("Nomor HP kosong"); continue; }
    if (telp.length < 8) { tolak(`Nomor HP "${teks(d.telp, 30)}" terlalu pendek`); continue; }
    if (telpDiFile.has(telp)) { tolak("Nomor HP kembar di dalam file ini"); continue; }
    if (master.telpTerpakai.has(telp)) { tolak("Nomor HP sudah terdaftar di sistem"); continue; }

    const katTeks = teks(d.kategori, 60);
    let categoryId: string | null = null;
    if (katTeks) {
      categoryId = master.kategori.get(katTeks.toLowerCase()) ?? null;
      if (!categoryId) { tolak(`Golongan "${katTeks}" belum terdaftar`); continue; }
    }

    telpDiFile.add(telp);
    siap.push({
      name: nama, phone: telp,
      email: kosongJadiNull(teks(d.email, 120)),
      address: kosongJadiNull(teks(d.alamat, 300)),
      category_id: categoryId,
      pekerjaan: kosongJadiNull(teks(d.pekerjaan, 80)),
      sumber_info: kosongJadiNull(teks(d.sumber_info, 60)),
      catatan: kosongJadiNull(teks(d.catatan, 500)),
      // NPWP hanya perlu untuk pembeli ber-NPWP; kosong itu wajar, bukan data kurang.
      npwp: kosongJadiNull(teks(d.npwp, 30)),
    });
  }

  return { siap, salah };
}

// ── Pemasok ───────────────────────────────────────────────────────────────────

export const KOLOM_PEMASOK = [
  "nama", "kontak", "telp", "alamat", "kategori", "npwp",
  "termin_hari", "bank_nama", "bank_rekening", "bank_atas_nama",
] as const;
export const WAJIB_PEMASOK = ["nama"] as const;

export const CONTOH_PEMASOK = [
  KOLOM_PEMASOK.join(","),
  "PT Sumber Pakan,Andi,0217654321,Jl. Industri 8,Distributor,01.234.567.8-901.000,30,BCA,1234567890,PT Sumber Pakan",
  "CV Obat Hewan,Rina,0218765432,Jl. Raya 22,,,14,Mandiri,9876543210,CV Obat Hewan",
].join("\n");

export type PemasokImpor = {
  nama: string; kontak: string | null; telp: string | null; alamat: string | null;
  category_id: string | null; npwp: string | null; termin_hari: number;
  bank_nama: string | null; bank_rekening: string | null; bank_atas_nama: string | null;
};

export type MasterPemasok = {
  kategori: Map<string, string>;
  /** nama pemasok yang sudah ada, huruf kecil */
  namaTerpakai: Set<string>;
};

export function periksaPemasok(baris: BarisCsv[], master: MasterPemasok): Hasil<PemasokImpor> {
  const siap: PemasokImpor[] = [];
  const salah: BarisSalah[] = [];
  const namaDiFile = new Set<string>();

  for (const b of baris) {
    const d = b.data;
    const nama = teks(d.nama, 100);
    const tolak = (pesan: string) => salah.push({ no: b.no, kode: nama || "—", pesan });

    if (!nama) { tolak("Nama pemasok kosong"); continue; }
    const namaKecil = nama.toLowerCase();
    if (namaDiFile.has(namaKecil)) { tolak("Nama kembar di dalam file ini"); continue; }
    if (master.namaTerpakai.has(namaKecil)) { tolak("Pemasok dengan nama ini sudah ada"); continue; }

    const katTeks = teks(d.kategori, 60);
    let categoryId: string | null = null;
    if (katTeks) {
      categoryId = master.kategori.get(katTeks.toLowerCase()) ?? null;
      if (!categoryId) { tolak(`Kategori pemasok "${katTeks}" belum terdaftar`); continue; }
    }

    // Termin kosong = 30 hari, sama dengan bawaan form manual.
    const termin = angka(d.termin_hari ?? "") ?? 30;
    if (termin < 0 || termin > 365) { tolak("Termin hari harus antara 0 dan 365"); continue; }

    namaDiFile.add(namaKecil);
    siap.push({
      nama,
      kontak: kosongJadiNull(teks(d.kontak, 60)),
      telp: kosongJadiNull(teks(d.telp, 20)),
      alamat: kosongJadiNull(teks(d.alamat, 300)),
      category_id: categoryId,
      npwp: kosongJadiNull(teks(d.npwp, 25)),
      termin_hari: termin,
      bank_nama: kosongJadiNull(teks(d.bank_nama, 60)),
      bank_rekening: kosongJadiNull(teks(d.bank_rekening, 40)),
      bank_atas_nama: kosongJadiNull(teks(d.bank_atas_nama, 100)),
    });
  }

  return { siap, salah };
}

// ── Bagan akun ────────────────────────────────────────────────────────────────
// Pemeriksaan & penyimpanan bagan akun ada di impor-akun.ts (pratinjau lengkap + RPC atomik).
// Di sini hanya kolom & contoh file yang ditampilkan di layar impor.

export { KOLOM_AKUN_KAMO as KOLOM_AKUN, KOLOM_AKUN_WAJIB as WAJIB_AKUN } from "./impor-akun-pemetaan";

// Induk boleh ditulis sesudah anaknya. Kode contoh tidak memakai kode sistem / jatah rekening.
export const CONTOH_AKUN = [
  "kode,nama,tipe,saldo_normal,induk,header,aktif",
  "5701,Beban Laundry Kandang,BEBAN,D,5700,,",
  "5700,Beban Klinik Lain,BEBAN,D,,ya,",
  "1401,Perlengkapan Kantor,ASET,D,,,",
].join("\n");
