// Kategori pengeluaran → akun beban COA. Cermin dari fungsi database public.expense_account_code
// (migrasi 20261123084004_kategori_pengeluaran_rinci.sql): database yang menentukan akun jurnal,
// daftar ini hanya untuk pilihan di form dan tampilan. Rincian dari tim keuangan (Anisa, 23 Nov 2026).
export const AKUN_KATEGORI_PENGELUARAN: Record<string, string> = {
  "Listrik": "720002",
  "Air": "720003",
  "Internet": "720004",
  "Tips Ongkir": "740017",
  "Bensin, Parkir & Toll": "740005",
  "Perawatan Peralatan": "720008",
  "Uang Makan": "740021",
  "Kebutuhan RT": "740016",
  "Marketing": "730002",
  "Kebersihan": "720005",
  "Keamanan": "720006",
  "IPL": "720009",
  "ATK": "740002",
  "Print dan FC": "740014",
  "Kebutuhan Grooming": "740013",
  "Kresek dan Thermal": "740022",
  "Ekspedisi": "740012",
  // Cadangan untuk yang tidak ada di daftar — tetap ke Beban Operasional Lain.
  "Lain-lain": "760003",
};

/** Kategori lama: tidak ditawarkan lagi untuk input baru, tetapi data lama tetap sah (filter, koreksi). */
export const AKUN_KATEGORI_LAMA: Record<string, string> = {
  "Operasional": "760003",
  "Listrik & Air": "720002",
  "Perlengkapan": "740001",
  "Transportasi": "740003",
  "Perawatan": "740007",
  "Perawatan Aset": "740007",
  "Sewa Gedung": "760003",
};

/** Pilihan untuk input pengeluaran baru (kasir petshop, klinik). */
export const KATEGORI_PENGELUARAN = Object.keys(AKUN_KATEGORI_PENGELUARAN);
/** Pilihan back office: daftar baru + Sewa Gedung (hanya dicatat dari back office). */
export const KATEGORI_PENGELUARAN_BACKOFFICE = [...KATEGORI_PENGELUARAN.filter((k) => k !== "Lain-lain"), "Sewa Gedung", "Lain-lain"];
/** Untuk filter daftar: kategori baru lalu kategori lama, supaya riwayat tetap bisa dicari. */
export const KATEGORI_PENGELUARAN_FILTER = [...KATEGORI_PENGELUARAN, ...Object.keys(AKUN_KATEGORI_LAMA)];

const BADGE_LAMA: Record<string, string> = {
  "Operasional": "b", "Listrik & Air": "g", "Perlengkapan": "o", "Transportasi": "pu", "Perawatan": "pk", "Lain-lain": "x",
};

/** Warna badge per kelompok akun (sewa & fasilitas hijau, marketing ungu, operasional oranye). */
export function badgeKategoriPengeluaran(kategori: string): string {
  if (BADGE_LAMA[kategori]) return BADGE_LAMA[kategori];
  const akun = AKUN_KATEGORI_PENGELUARAN[kategori];
  if (!akun) return "x";
  if (akun.startsWith("72")) return "g";
  if (akun.startsWith("73")) return "pu";
  return "o";
}
