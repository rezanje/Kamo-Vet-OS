// Fixture uji Admin Online: daftar rute nyata aplikasi + matriks hak buka per peran.
// Dipakai (1) tes matriks rute peran Admin Online, (2) snapshot "peran lain tidak berubah"
// (snapshot dibuat dari origin/main SEBELUM peran ini ada: fixtures/admin-online-peran-lain.snapshot.json).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const APP = join(process.cwd(), "src/app");

/** Semua halaman (page.tsx) dan route handler (route.ts) -> URL. Grup (x) dibuang, [param] -> "contoh". */
export function daftarRute(): { url: string; file: string; kind: "page" | "route" }[] {
  const out: { url: string; file: string; kind: "page" | "route" }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      const kind = name === "page.tsx" ? "page" : name === "route.ts" ? "route" : null;
      if (!kind) continue;
      const rel = full.slice(APP.length).replace(/\\/g, "/").replace(/\/(page\.tsx|route\.ts)$/, "");
      const url = rel.split("/").filter(seg => seg && !/^\(.*\)$/.test(seg)).map(seg => (/^\[.*\]$/.test(seg) ? "contoh" : seg)).join("/");
      out.push({ url: "/" + url, file: full, kind });
    }
  };
  walk(APP);
  return out.sort((a, b) => a.url.localeCompare(b.url) || a.file.localeCompare(b.file));
}

export const baca = (file: string) => readFileSync(file, "utf8");

/** Jalur tambahan di luar berkas rute (sidebar, tautan, varian query/hash/%-encoding). */
export const JALUR_EKSTRA = [
  "/", "/me", "/mulai", "/mulai/cabang", "/login", "/auth/callback", "/booking", "/kasir", "/kasir/quest", "/pos", "/pos/shift", "/pos/quest", "/pos/sku",
  "/klinik", "/crm", "/hris", "/pengaturan", "/pengaturan/pengguna", "/pengaturan/akses-grup", "/perusahaan", "/perusahaan/log-aktifitas",
  "/buku-besar", "/kas-bank", "/penjualan", "/penjualan/online", "/penjualan/online/baru", "/pembelian", "/laporan",
  "/keuangan/jurnal", "/keuangan/laba-rugi", "/keuangan/neraca", "/keuangan/aset", "/keuangan/ppn", "/pajak", "/aset-tetap",
  "/penjualan/online/impor?x=1", "/penjualan/online/impor#a", "/penjualan/online/impor/", "/penjualan/online/impor/lain", "/penjualan/online/imporx",
  "/penjualan/online/%69mpor", "/PENJUALAN/ONLINE/IMPOR", "//penjualan/online/impor", "/penjualan/online/impor/../baru", "/penjualan/online/./impor",
  "/penjualan/online/impor%2f..%2fbaru", "/penjualan/online/impor%00", "/penjualan\\online\\impor", "/api/cari", "/api/pelanggan", "/api/impor/accurate/progres",
];

export const PERAN_LAMA = ["OWNER", "ADMIN", "FINANCE", "STAFF", "DOCTOR"] as const;
export const SET_ATURAN: Record<string, { role: string; module_id: string; submenus?: string[] }[]> = {
  bawaan: [],
  satu_modul: PERAN_LAMA.flatMap(role => [{ role, module_id: "pengaturan" }]),
  v2_kasir_klinik: PERAN_LAMA.flatMap(role => [{ role, module_id: "__role_v2__" }, { role, module_id: "kasir" }, { role, module_id: "klinik" }]),
  penjualan_sub: PERAN_LAMA.flatMap(role => [{ role, module_id: "penjualan", submenus: ["penjualan.online"] }]),
};

type Aturan = { role: string; module_id: string; submenus?: string[] }[];
type Fns = {
  bolehBukaPath: (role: string, path: string, rules: Aturan) => boolean;
  modulDiizinkan: (role: string, rules: Aturan) => string[] | null;
  tujuanSaatDiblokir: (role: string, rules: Aturan) => string;
};

/** Matriks peran lama: boleh-buka per (peran, aturan, jalur) + modul + tujuan saat diblokir. Deterministik. */
export function matriksPeranLama(f: Fns): Record<string, unknown> {
  const jalur = [...new Set([...daftarRute().map(r => r.url), ...JALUR_EKSTRA])].sort();
  const out: Record<string, unknown> = {};
  for (const role of PERAN_LAMA) {
    for (const [nama, rules] of Object.entries(SET_ATURAN)) {
      out[`${role}|${nama}|modul`] = f.modulDiizinkan(role, rules);
      out[`${role}|${nama}|tujuan`] = f.tujuanSaatDiblokir(role, rules);
      out[`${role}|${nama}|buka`] = jalur.filter(p => f.bolehBukaPath(role, p, rules)).join(",");
    }
  }
  return out;
}
