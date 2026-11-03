// Akses Grup (migrasi 0101) — murni, dites di __tests__/akses.test.ts
//
// Satu tempat memutuskan "peran ini boleh buka apa", dipakai sidebar DAN middleware.
// Sebelumnya dua-duanya punya daftar sendiri dan gampang tidak sinkron.

export const SEMUA_PERAN = ["OWNER", "ADMIN", "FINANCE", "STAFF", "DOCTOR"] as const;
export type Peran = (typeof SEMUA_PERAN)[number];
export const ROLE_V2_MARKER = "__role_v2__";
export const OPERATIONAL_PATHS: Record<string, string[]> = {
  kasir: ["/kasir"],
  "quest-staff": ["/pos/quest", "/kasir/quest"],
  "pos-shift": ["/pos/shift"],
};

/**
 * Modul → prefix URL yang dikuasainya.
 *
 * Sebagian layar keuangan tinggal di `/keuangan/*` sejak sebelum modul dipisah
 * ala Accurate, jadi prefiksnya disebut satu per satu. Memakai `/keuangan` polos
 * akan memberi seluruh dunia keuangan ke siapa pun yang punya satu modul saja.
 */
export const MODULE_PATHS: Record<string, string[]> = {
  ...OPERATIONAL_PATHS,
  dashboard: ["/"],
  klinik: ["/klinik"],
  crm: ["/crm"],
  hris: ["/hris"],
  pengaturan: ["/pengaturan"],
  perusahaan: ["/perusahaan"],
  "buku-besar": [
    "/buku-besar", "/keuangan/coa", "/keuangan/jurnal", "/keuangan/jurnal-berulang",
    "/keuangan/buku-besar", "/keuangan/tutup-buku", "/keuangan/closing-hpp", "/keuangan/saldo-awal", "/keuangan/saldo-awal-faktur", "/keuangan/sinkron",
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
// `/booking` = formulir publik pemilik hewan; karyawan yang sedang login pun
// boleh membukanya (mis. mendaftarkan pelanggan lewat telepon).
export const SELALU_BOLEH = ["/me", "/mulai", "/login", "/auth", "/booking"];

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
export function roleUsesLegacyStaffShell(role: string, rules: AturanTersimpan): boolean {
  return role === "STAFF" && !rules.some(r => r.role === role && r.module_id === ROLE_V2_MARKER);
}

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
  return milikDia.length > 0 ? milikDia.filter(id => id !== ROLE_V2_MARKER) : modulBawaan(role);
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
  if (role === "OWNER") return true;
  const v2 = tersimpan.some(r => r.role === role && r.module_id === ROLE_V2_MARKER);
  if (v2) path = path.split(/[?#]/)[0];
  if (SELALU_BOLEH.some((p) => cocokPrefix(path, p))) return true;
  if (!v2 && (JALUR_TAMBAHAN[role] ?? []).some((p) => cocokPrefix(path, p))) return true;

  const modul = modulDiizinkan(role, tersimpan);
  if (modul === null) return true; // akses penuh
  if (v2) {
    // Query/hash variants are the same menu; preserve historical matcher outside v2.
    const pathname = path.split(/[?#]/)[0];
    // Reach parity: a role whose ORIGINAL default was "every module" (ADMIN/DOCTOR) displays every catalogue id
    // and keeps the original full reach — including the pages no module prefix owns (/pajak*, /aset-tetap*,
    // /keuangan/laba-ditahan*, /keuangan, /dokumen/*, ...). Any partial selection never gets them: the original
    // matcher never granted those to a restricted role, so saving the displayed list must not either.
    if (modulBawaan(role) === null && Object.keys(MODULE_PATHS).every(id => modul.includes(id))) return true;
    // Operational groups (kasir, quest-staff, pos-shift) are more specific than the module that contains their
    // URLs (/pos), so the longest operational prefix governs and `pos` alone cannot open /pos/shift or /pos/quest.
    const operational = Object.entries(OPERATIONAL_PATHS)
      .flatMap(([id, paths]) => paths.map(prefix => ({ id, prefix })))
      .filter(({ prefix }) => cocokPrefix(pathname, prefix))
      .sort((a, b) => b.prefix.length - a.prefix.length)[0];
    if (operational) {
      if (!modul.includes(operational.id)) return false;
      // Quest has two screens: /kasir/quest (cashier) and /pos/quest (the POS module's configuration screen).
      // `quest-staff` is the quest feature; each screen also needs its own area: Kasir for /kasir/quest, POS for
      // /pos/quest. This keeps the displayed default exactly the original reach: STAFF/DOCTOR reached only
      // /kasir/quest, roles with the legacy pos module reached only /pos/quest. Kasir or pos alone never grant it.
      if (operational.id === "quest-staff") return modul.includes(operational.prefix === "/pos/quest" ? "pos" : "kasir");
      return true;
    }
    // Real modules: ANY granted module whose prefix matches opens the path, exactly like the original matcher
    // (so `pengaturan` still opens /pengaturan/pajak, as it always did).
    return modul.some(id => !(id in OPERATIONAL_PATHS) && (MODULE_PATHS[id] ?? []).some(p => cocokPrefix(pathname, p)));
  }

  return modul.some((id) => (MODULE_PATHS[id] ?? []).some((p) => cocokPrefix(path, p)));
}

/** Halaman tujuan saat sebuah URL diblokir — jangan pernah melempar ke halaman yang juga diblokir. */
export function tujuanSaatDiblokir(role: string, tersimpan: AturanTersimpan): string {
  const modul = modulDiizinkan(role, tersimpan);
  if (modul === null || modul.includes("dashboard")) return "/";
  return "/mulai";
}
