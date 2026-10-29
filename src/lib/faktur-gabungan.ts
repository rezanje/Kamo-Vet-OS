// Daftar Faktur Penjualan gabungan ala Accurate — logika murni,
// dites di __tests__/faktur-gabungan.test.ts.
//
// Permintaan Andri: "kenapa harus dipisah-pisah? itu termasuk penjualan".
// Jadi SATU daftar memuat semua penjualan apa pun bentuk dokumennya:
//   petshop = struk kasir/POS & online (`sales`)
//   klinik  = tagihan hasil pemeriksaan (`invoices`)
//   grosir  = faktur penjualan reseller (`sales_invoices`)
//
// Daftar ini hanya MENGANTAR ke dokumen aslinya. Koreksi harga, pembayaran,
// dan pembatalan tetap dikerjakan di halaman dokumen masing-masing supaya
// aturan dan jurnalnya tidak perlu ditulis dua kali.

export const SUMBER_FAKTUR = ["petshop", "klinik", "grosir"] as const;
export type SumberFaktur = (typeof SUMBER_FAKTUR)[number];

export const SUMBER_LABEL: Record<SumberFaktur, string> = {
  petshop: "Petshop",
  klinik: "Klinik",
  grosir: "Grosir",
};

export const STATUS_FAKTUR = ["lunas", "belum", "batal"] as const;
export type StatusFaktur = (typeof STATUS_FAKTUR)[number];

export const STATUS_LABEL: Record<StatusFaktur, string> = {
  lunas: "Lunas",
  belum: "Belum Lunas",
  batal: "Dibatalkan",
};

/**
 * Baris ringkas satu dokumen penjualan — hanya kolom yang dipakai untuk
 * mengurutkan, menyaring, menghitung, dan memotong halaman.
 *
 * Nama pelanggan dan cabang SENGAJA tidak ada di sini: mengambilnya untuk
 * seluruh rentang tanggal berarti menarik ribuan baris berelasi hanya untuk
 * menampilkan lima puluh. Nama diambil belakangan, khusus baris yang tampil.
 */
export type KunciFaktur = {
  id: string;
  sumber: SumberFaktur;
  /** Nomor dokumen. Kosong pada struk yang belum sempat dinomori. */
  nomor: string;
  /** YYYY-MM-DD menurut WIB. */
  tanggal: string;
  /** Total dokumen apa adanya, termasuk pajak — lihat `catatanTotal`. */
  total: number;
  status: StatusFaktur;
  branchId: string | null;
  customerId: string | null;
  /** Nama pembeli bebas pada struk marketplace yang tidak punya kartu pelanggan. */
  namaBebas: string | null;
};

/** Nama pelanggan, cabang, dan keterangan baris yang benar-benar tampil. */
export type BarisFaktur = KunciFaktur & {
  cabang: string;
  pelanggan: string;
  keterangan: string;
  /** Kunjungan klinik — dipakai menyusun tautan ke halaman pembayarannya. */
  visitId: string | null;
  /**
   * Dokumen ini punya baris bermodal, jadi rincian HPP-nya bisa dibuka lewat
   * nomornya. Faktur saldo awal dan faktur selisih stok tidak punya.
   */
  rincianHpp: boolean;
};

/**
 * Definisi angka Total di daftar ini, supaya cocok dengan laporan omzet:
 * nilai dokumen apa adanya saat disimpan, sudah termasuk pajak, SEBELUM retur.
 * Retur penjualan tidak dikurangkan di sini karena retur adalah dokumen lain.
 */
export const CATATAN_TOTAL =
  "Total = nilai dokumen apa adanya saat disimpan (sudah termasuk pajak), sebelum retur. " +
  "Angkanya sama dengan omzet kotor di laporan penjualan untuk filter yang sama.";

/** Urutan daftar: tanggal terbaru dulu, lalu nomor terbesar. Sisanya penentu tetap. */
export function bandingFaktur(a: KunciFaktur, b: KunciFaktur): number {
  return b.tanggal.localeCompare(a.tanggal)
    || b.nomor.localeCompare(a.nomor)
    || a.sumber.localeCompare(b.sumber)
    || a.id.localeCompare(b.id);
}

export function urutkanFaktur<T extends KunciFaktur>(rows: readonly T[]): T[] {
  return [...rows].sort(bandingFaktur);
}

/**
 * Gabung beberapa sumber yang MASING-MASING sudah urut jadi satu daftar urut.
 *
 * Tiap sumber ditarik dengan urutan yang sama dari databasenya, jadi
 * penggabungannya cukup sekali jalan: ambil kepala yang paling baru, maju.
 * Daftar yang masuk tetap diurutkan ulang lebih dulu supaya hasilnya benar
 * walau pemanggilnya lalai — biayanya nyaris nol untuk daftar yang sudah urut.
 */
export function gabungFaktur<T extends KunciFaktur>(sumber: readonly (readonly T[])[]): T[] {
  const daftar = sumber.map(urutkanFaktur);
  const posisi = daftar.map(() => 0);
  const total = daftar.reduce((jumlah, isi) => jumlah + isi.length, 0);
  const hasil: T[] = [];
  for (let n = 0; n < total; n++) {
    let pilih = -1;
    for (let i = 0; i < daftar.length; i++) {
      if (posisi[i] >= daftar[i].length) continue;
      if (pilih < 0 || bandingFaktur(daftar[i][posisi[i]], daftar[pilih][posisi[pilih]]) < 0) pilih = i;
    }
    if (pilih < 0) break;
    hasil.push(daftar[pilih][posisi[pilih]++]);
  }
  return hasil;
}

/** Umur tagihan dalam hari. Hanya berarti untuk dokumen yang belum lunas. */
export function umurFaktur(tanggal: string, hariIni: string): number | null {
  if (!tanggal || !hariIni) return null;
  const mulai = Date.parse(`${tanggal}T00:00:00Z`);
  const kini = Date.parse(`${hariIni}T00:00:00Z`);
  if (!Number.isFinite(mulai) || !Number.isFinite(kini)) return null;
  return Math.max(0, Math.round((kini - mulai) / 86_400_000));
}

/** Tautan ke dokumen ASLI — di sanalah rincian, pembayaran, dan tombol aksinya. */
export function hrefFaktur(row: Pick<BarisFaktur, "sumber" | "id" | "visitId">): string {
  if (row.sumber === "petshop") return `/penjualan/${row.id}`;
  if (row.sumber === "grosir") return `/penjualan/faktur/${row.id}`;
  // Tagihan klinik dibuka lewat kunjungannya; tanpa kunjungan tidak ada halaman
  // yang bisa dituju, jadi daftar kunjungan yang dibuka, bukan tautan rusak.
  return row.visitId ? `/klinik/pembayaran/${row.visitId}` : "/klinik/pembayaran";
}

const mengandung = (teks: string | null, kueri: string) =>
  !!teks && teks.toLowerCase().includes(kueri);

/** Cocok dengan nama pelanggan: kartu pelanggan yang sudah dicarikan, atau nama bebas di struk. */
export function cocokPelanggan(row: KunciFaktur, kueri: string, idPelanggan: ReadonlySet<string>): boolean {
  if (!kueri) return true;
  if (mengandung(row.namaBebas, kueri.toLowerCase())) return true;
  return !!row.customerId && idPelanggan.has(row.customerId);
}

/** Kotak cari tunggal: nomor dokumen ATAU nama pelanggan. */
export function cocokCari(row: KunciFaktur, kueri: string, idPelanggan: ReadonlySet<string>): boolean {
  if (!kueri) return true;
  if (mengandung(row.nomor, kueri.toLowerCase())) return true;
  return cocokPelanggan(row, kueri, idPelanggan);
}

export type SaringanFaktur = {
  status?: StatusFaktur | "";
  cari?: string;
  idCari?: ReadonlySet<string>;
  pelanggan?: string;
  idPelanggan?: ReadonlySet<string>;
};

const KOSONG: ReadonlySet<string> = new Set();

/**
 * Saringan yang tidak bisa dititipkan ke database.
 *
 * Status dihitung dari status tersimpan dokumennya (termasuk "dibatalkan"),
 * jadi menyaringnya di sini menjamin kolom Status dan filternya selalu sepakat.
 * Pencarian nama pelanggan dipakai di sini karena nama klinik tersimpan di
 * tabel kunjungan, bukan di fakturnya.
 */
export function saringFaktur<T extends KunciFaktur>(rows: readonly T[], saringan: SaringanFaktur): T[] {
  const cari = (saringan.cari ?? "").trim();
  const pelanggan = (saringan.pelanggan ?? "").trim();
  return rows.filter((row) =>
    (!saringan.status || row.status === saringan.status)
    && cocokCari(row, cari, saringan.idCari ?? KOSONG)
    && cocokPelanggan(row, pelanggan, saringan.idPelanggan ?? KOSONG));
}

export type RingkasanFaktur = {
  jumlah: number;
  total: number;
  jumlahBelum: number;
  totalBelum: number;
};

/** Kaki daftar: berapa dokumen dan berapa rupiah untuk SELURUH hasil saringan. */
export function ringkasFaktur(rows: readonly KunciFaktur[]): RingkasanFaktur {
  let total = 0, jumlahBelum = 0, totalBelum = 0;
  for (const row of rows) {
    total += Number(row.total) || 0;
    if (row.status === "belum") {
      jumlahBelum++;
      totalBelum += Number(row.total) || 0;
    }
  }
  return { jumlah: rows.length, total, jumlahBelum, totalBelum };
}

export const KOLOM_EKSPOR = [
  "Nomor", "Tanggal", "Cabang", "Sumber", "Pelanggan", "Keterangan", "Status", "Umur (hari)", "Total",
] as const;

/** Satu baris ekspor per dokumen, urutannya persis kolom di layar. */
export function barisEkspor(rows: readonly BarisFaktur[], hariIni: string): (string | number)[][] {
  return rows.map((row) => {
    const umur = row.status === "belum" ? umurFaktur(row.tanggal, hariIni) : null;
    return [
      row.nomor || "(tanpa nomor)",
      row.tanggal,
      row.cabang,
      SUMBER_LABEL[row.sumber],
      row.pelanggan,
      row.keterangan,
      STATUS_LABEL[row.status],
      umur ?? "",
      Number(row.total) || 0,
    ];
  });
}
