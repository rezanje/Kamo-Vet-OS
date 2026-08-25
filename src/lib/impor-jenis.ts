// Satu daftar jenis impor master data — dipakai halaman, formulir, dan aksi
// simpannya, supaya kolom yang dijanjikan ke pemakai persis sama dengan yang
// dibaca server.
import {
  KOLOM_PELANGGAN, WAJIB_PELANGGAN, CONTOH_PELANGGAN,
  KOLOM_PEMASOK, WAJIB_PEMASOK, CONTOH_PEMASOK,
  KOLOM_AKUN, WAJIB_AKUN, CONTOH_AKUN,
} from "./impor-master";
import {
  KOLOM_KOMISI, WAJIB_KOMISI, CONTOH_KOMISI,
  KOLOM_TARGET, WAJIB_TARGET, CONTOH_TARGET,
} from "./impor-komisi";

export const JENIS_IMPOR = ["pelanggan", "pemasok", "akun", "komisi", "target"] as const;
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
      "dan yang sudah terdaftar tidak ditimpa. Golongan pelanggan harus sudah ada di master. " +
      "NPWP hanya perlu untuk pembeli ber-NPWP (perusahaan) — kosongkan untuk pembeli pribadi.",
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
  komisi: {
    judul: "IMPOR ATURAN KOMISI",
    desc: "Masukkan banyak aturan komisi sekaligus dari file CSV",
    ikon: "ti-percentage",
    kembali: "/penjualan/komisi",
    kembaliLabel: "Komisi Penjual",
    kolom: KOLOM_KOMISI,
    wajib: WAJIB_KOMISI,
    contoh: CONTOH_KOMISI,
    namaFile: "contoh-impor-komisi.csv",
    catatan:
      "Tipe diisi persen atau nominal — persen wajib mengisi kolom persen, nominal wajib mengisi kolom nominal. " +
      "Basis: omzet atau laba. Sumber: semua / kasir / klinik / reseller. " +
      "Kolom karyawan, cabang, kategori, dan barang diisi NAMANYA (barang boleh kodenya) dan harus sudah ada di master — " +
      "kalau tidak ketemu barisnya ditolak, bukan ditebak. Kosongkan berarti berlaku untuk semua. " +
      "Tanggal berlaku memakai format YYYY-MM-DD.",
  },
  target: {
    judul: "IMPOR TARGET PENJUALAN",
    desc: "Masukkan target penjualan banyak periode sekaligus dari file CSV",
    ikon: "ti-target-arrow",
    kembali: "/penjualan/target",
    kembaliLabel: "Target Penjualan",
    kolom: KOLOM_TARGET,
    wajib: WAJIB_TARGET,
    contoh: CONTOH_TARGET,
    namaFile: "contoh-impor-target.csv",
    catatan:
      "Periode memakai format YYYY-MM. Kolom karyawan, cabang, dan kategori diisi NAMANYA dan harus sudah ada " +
      "di master; kosongkan berarti target itu berlaku untuk seluruh perusahaan. " +
      "Dua target dengan cakupan yang sama persis ditolak — kalau tidak, capaiannya terhitung dua kali.",
  },
};

export const isJenisImpor = (v: string): v is JenisImpor =>
  (JENIS_IMPOR as readonly string[]).includes(v);
