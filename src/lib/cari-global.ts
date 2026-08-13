// Pencarian global — satu kotak untuk mencari MENU maupun DATA.
// Murni, dites di __tests__/cari-global.test.ts.
//
// Menu dicari di layar (daftarnya statis & kecil), data dicari di server. Yang
// ada di sini bagian menunya + aturan pemeringkatan yang dipakai keduanya.

import { MODULES, MODULE_LABEL, TILES } from "./nav";
import { bolehBukaPath, type AturanTersimpan } from "./akses";

export type HasilMenu = {
  label: string;
  href: string;
  modul: string;
  modulLabel: string;
  icon: string;
};

/** Semua tile yang punya halaman sungguhan — tile "dalam pengembangan" dilewati. */
export function daftarMenu(): HasilMenu[] {
  const hasil: HasilMenu[] = [];

  for (const m of MODULES) {
    for (const t of TILES[m.id] ?? []) {
      if (!t.href || t.p2) continue;
      hasil.push({
        label: t.label, href: t.href, modul: m.id,
        modulLabel: MODULE_LABEL[m.id] ?? m.id, icon: t.icon,
      });
    }
  }
  return hasil;
}

/**
 * Skor kecocokan. Semakin kecil semakin bagus; -1 = tidak cocok.
 *
 * Urutannya sengaja: yang diketik orang biasanya awal kata ("pel" → Pelanggan),
 * jadi awalan menang atas potongan di tengah kata.
 */
export function skorCocok(teks: string, kueri: string): number {
  const t = teks.toLowerCase();
  const q = kueri.trim().toLowerCase();
  if (!q) return -1;
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;

  // Awal kata mana pun, mis. "opname" cocok ke "Stok opname".
  const kata = t.split(/[\s/&·—-]+/);
  if (kata.some((k) => k.startsWith(q))) return 2;

  return t.includes(q) ? 3 : -1;
}

/**
 * Menu yang cocok DAN boleh dibuka peran ini. Menyaring hak akses di sini penting:
 * hasil pencarian yang mengantar ke halaman terlarang bikin orang mengira sistemnya
 * rusak, padahal memang tidak berhak.
 */
export function cariMenu(
  kueri: string,
  role: string,
  aturan: AturanTersimpan,
  batas = 6,
): HasilMenu[] {
  const q = kueri.trim();
  if (q.length < 2) return [];

  return daftarMenu()
    .filter((m) => bolehBukaPath(role, m.href, aturan))
    .map((m) => {
      // Nama modulnya ikut dicocokkan supaya "keuangan"/"klinik" memunculkan isinya.
      const skor = Math.min(
        skorCocok(m.label, q) === -1 ? 99 : skorCocok(m.label, q),
        skorCocok(m.modulLabel, q) === -1 ? 99 : skorCocok(m.modulLabel, q) + 4,
      );
      return { m, skor };
    })
    .filter((x) => x.skor < 99)
    .sort((a, b) => a.skor - b.skor || a.m.label.localeCompare(b.m.label))
    .slice(0, batas)
    .map((x) => x.m);
}

/** Karakter yang bikin pola ILIKE Postgres jadi liar kalau diketik pengguna. */
export function amankanKueri(kueri: string): string {
  return kueri.trim().replace(/[%_,()]/g, " ").slice(0, 60);
}

export type JenisData =
  | "barang" | "pelanggan" | "hewan" | "pemasok" | "karyawan" | "nota-klinik" | "struk-kasir";

export type HasilData = {
  jenis: JenisData;
  judul: string;
  keterangan: string;
  href: string;
};

/** Label & ikon tiap jenis hasil — dipakai layar supaya tidak menebak sendiri. */
export const LABEL_JENIS: Record<JenisData, { label: string; icon: string }> = {
  barang: { label: "Barang & Jasa", icon: "ti-package" },
  pelanggan: { label: "Pelanggan", icon: "ti-users-group" },
  hewan: { label: "Hewan", icon: "ti-paw" },
  pemasok: { label: "Pemasok", icon: "ti-building-store" },
  karyawan: { label: "Karyawan", icon: "ti-id-badge" },
  "nota-klinik": { label: "Nota Klinik", icon: "ti-file-invoice" },
  "struk-kasir": { label: "Struk Kasir", icon: "ti-receipt" },
};
