// Akses Grup (migrasi 0101) — murni, dites di __tests__/akses.test.ts
//
// Satu tempat memutuskan "peran ini boleh buka apa", dipakai sidebar DAN middleware.
// Sebelumnya dua-duanya punya daftar sendiri dan gampang tidak sinkron.

export const SEMUA_PERAN = ["OWNER", "ADMIN", "FINANCE", "STAFF", "DOCTOR"] as const;
export type Peran = (typeof SEMUA_PERAN)[number];

/**
 * Modul → prefix URL yang dikuasainya.
 *
 * Sebagian layar keuangan tinggal di `/keuangan/*` sejak sebelum modul dipisah
 * ala Accurate, jadi prefiksnya disebut satu per satu. Memakai `/keuangan` polos
 * akan memberi seluruh dunia keuangan ke siapa pun yang punya satu modul saja.
 */
export const MODULE_PATHS: Record<string, string[]> = {
  dashboard: ["/"],
  klinik: ["/klinik"],
  crm: ["/crm"],
  hris: ["/hris"],
  pengaturan: ["/pengaturan"],
  perusahaan: ["/perusahaan"],
  "buku-besar": [
    "/buku-besar", "/keuangan/coa", "/keuangan/jurnal", "/keuangan/jurnal-berulang",
    "/keuangan/buku-besar", "/keuangan/tutup-buku", "/keuangan/sinkron",
  ],
  "kas-bank": [
    "/kas-bank", "/keuangan/hutang", "/keuangan/piutang", "/keuangan/rekonsiliasi",
  ],
  penjualan: ["/penjualan"],
  pembelian: ["/pembelian"],
  pos: ["/pos"],
  "aset-tetap": ["/keuangan/aset", "/keuangan/kategori-aset", "/keuangan/kategori-aset-pajak"],
  pajak: ["/keuangan/ppn", "/pengaturan/pajak"],
  laporan: [
    "/laporan", "/keuangan/laba-rugi", "/keuangan/neraca", "/keuangan/neraca-saldo",
    "/keuangan/arus-kas",
  ],
};

/** Halaman yang tidak pernah diblokir: login, dashboard pribadi, dan pemilih shift. */
export const SELALU_BOLEH = ["/me", "/mulai", "/login", "/auth"];

/**
 * Jalur non-modul yang melekat pada peran tertentu dan TIDAK diatur lewat layar
 * Akses Grup. Layar kasir bukan modul sidebar, tapi tanpa ini kasir tidak bisa kerja.
 */
export const JALUR_TAMBAHAN: Record<string, string[]> = {
  STAFF: ["/kasir"],
  DOCTOR: ["/kasir"],
  FINANCE: ["/pos/shift"],
};

/** Aturan bawaan — persis perilaku sebelum Akses Grup ada. null = seluruh modul. */
export function modulBawaan(role: string): string[] | null {
  if (role === "FINANCE") return ["dashboard", "buku-besar", "kas-bank", "aset-tetap", "pajak", "laporan"];
  if (role === "STAFF") return ["klinik"];
  return null; // OWNER, ADMIN, DOCTOR — seluruh modul
}

export type AturanTersimpan = { role: string; module_id: string }[];

/**
 * Modul yang boleh dibuka satu peran. null = semua modul.
 *
 * OWNER selalu penuh apa pun isi tabelnya — jaminan pemilik tidak bisa mengunci
 * dirinya sendiri keluar. Peran tanpa baris tersimpan memakai bawaan, jadi
 * memasang fitur ini tidak diam-diam mengubah hak akses siapa pun.
 */
export function modulDiizinkan(role: string, tersimpan: AturanTersimpan): string[] | null {
  if (role === "OWNER") return null;
  const milikDia = tersimpan.filter((r) => r.role === role).map((r) => r.module_id);
  return milikDia.length > 0 ? milikDia : modulBawaan(role);
}

/** Peran ini sedang memakai aturan sendiri, atau masih bawaan? */
export function pakaiAturanSendiri(role: string, tersimpan: AturanTersimpan): boolean {
  return role !== "OWNER" && tersimpan.some((r) => r.role === role);
}

const cocokPrefix = (path: string, prefix: string): boolean =>
  prefix === "/" ? path === "/" : path === prefix || path.startsWith(prefix + "/");

/**
 * Boleh buka URL ini?
 *
 * Prefix yang lebih panjang menang secara alami karena dicek satu per satu:
 * `/keuangan/aset` bisa diberikan tanpa ikut memberi `/keuangan/jurnal`.
 */
export function bolehBukaPath(role: string, path: string, tersimpan: AturanTersimpan): boolean {
  if (SELALU_BOLEH.some((p) => cocokPrefix(path, p))) return true;
  if ((JALUR_TAMBAHAN[role] ?? []).some((p) => cocokPrefix(path, p))) return true;

  const modul = modulDiizinkan(role, tersimpan);
  if (modul === null) return true; // akses penuh

  return modul.some((id) => (MODULE_PATHS[id] ?? []).some((p) => cocokPrefix(path, p)));
}

/** Halaman tujuan saat sebuah URL diblokir — jangan pernah melempar ke halaman yang juga diblokir. */
export function tujuanSaatDiblokir(role: string, tersimpan: AturanTersimpan): string {
  const modul = modulDiizinkan(role, tersimpan);
  if (modul === null || modul.includes("dashboard")) return "/";
  return "/mulai";
}
