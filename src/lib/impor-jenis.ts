// Satu daftar jenis impor master data — dipakai halaman, formulir, dan aksi
// simpannya, supaya kolom yang dijanjikan ke pemakai persis sama dengan yang
// dibaca server.
import {
  KOLOM_PELANGGAN, WAJIB_PELANGGAN, CONTOH_PELANGGAN,
  KOLOM_PEMASOK, WAJIB_PEMASOK, CONTOH_PEMASOK,
  KOLOM_AKUN, WAJIB_AKUN, CONTOH_AKUN,
} from "./impor-master";

export const JENIS_IMPOR = ["pelanggan", "pemasok", "akun"] as const;
export type JenisImpor = (typeof JENIS_IMPOR)[number];

export type KonfigImpor = {
  judul: string;
  desc: string;
  ikon: string;
  kembali: string;
  kembaliLabel: string;
  kolom: readonly string[];
  wajib: readonly string[];
  contoh: string;
  namaFile: string;
  /** Catatan syarat khusus jenis ini, ditampilkan di bawah daftar kolom. */
  catatan: string;
};

export const KONFIG: Record<JenisImpor, KonfigImpor> = {
  pelanggan: {
    judul: "IMPOR PELANGGAN",
    desc: "Masukkan banyak pelanggan sekaligus dari file CSV",
    ikon: "ti-users-group",
    kembali: "/crm/pelanggan",
    kembaliLabel: "Data Pelanggan",
    kolom: KOLOM_PELANGGAN,
    wajib: WAJIB_PELANGGAN,
    contoh: CONTOH_PELANGGAN,
    namaFile: "contoh-impor-pelanggan.csv",
    catatan:
      "Nomor HP jadi penanda pelanggan: 0812…, +62812…, dan 812… dianggap orang yang sama, " +
      "dan yang sudah terdaftar tidak ditimpa. Golongan pelanggan harus sudah ada di master.",
  },
  pemasok: {
    judul: "IMPOR PEMASOK",
    desc: "Masukkan banyak pemasok sekaligus dari file CSV",
    ikon: "ti-building-store",
    kembali: "/pembelian?tab=supplier",
    kembaliLabel: "Pemasok",
    kolom: KOLOM_PEMASOK,
    wajib: WAJIB_PEMASOK,
    contoh: CONTOH_PEMASOK,
    namaFile: "contoh-impor-pemasok.csv",
    catatan:
      "Nama pemasok tidak boleh kembar. Termin kosong dianggap 30 hari. " +
      "Kategori pemasok harus sudah ada di master.",
  },
  akun: {
    judul: "IMPOR BAGAN AKUN",
    desc: "Masukkan banyak akun perkiraan sekaligus dari file CSV",
    ikon: "ti-clipboard-list",
    kembali: "/keuangan/coa",
    kembaliLabel: "Akun Perkiraan",
    kolom: KOLOM_AKUN,
    wajib: WAJIB_AKUN,
    contoh: CONTOH_AKUN,
    namaFile: "contoh-impor-akun.csv",
    catatan:
      "Tipe diisi ASET / LIABILITAS / EKUITAS / PENDAPATAN / BEBAN. Saldo normal boleh dikosongkan — " +
      "terisi sendiri sesuai tipenya. Kolom induk diisi KODE akun induknya, boleh akun yang ada di file ini juga.",
  },
};

export const isJenisImpor = (v: string): v is JenisImpor =>
  (JENIS_IMPOR as readonly string[]).includes(v);
