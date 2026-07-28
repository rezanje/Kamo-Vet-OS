// Tab halaman ala Accurate: halaman yang pernah dibuka disimpan sebagai tab
// supaya bisa gonta-ganti tanpa lewat sidebar lagi. Logika murni di sini,
// komponennya di `src/components/PageTabs.tsx`.
//
// ponytail: tab hanya menyimpan alamat halaman, BUKAN state form di dalamnya.
// Pindah tab = navigasi biasa (client-side, cepat). Kalau suatu saat butuh
// form setengah jadi ikut tersimpan, itu pekerjaan lain (perlu satu route tree
// per tab / iframe) dan jauh lebih mahal.

import { MODULE_LABEL, TILES } from "./nav";

export type PageTab = { href: string; label: string };

export const HOME_TAB: PageTab = { href: "/", label: "Dashboard" };

/** Maksimum tab terbuka. Tab terlama (selain Dashboard) dibuang saat penuh. */
export const MAX_TABS = 10;

// Peta href → label, dipungut dari tile yang sudah terdaftar di nav.ts.
// Dibangun sekali saat modul dimuat.
const TILE_LABEL: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const tiles of Object.values(TILES)) {
    for (const t of tiles) {
      if (!t.href) continue;
      const path = t.href.split("?")[0];
      // tile pertama yang klaim sebuah path yang menang (mis. "Hasil Stok
      // Opname" tidak menimpa "Perintah Stok Opname" yang href-nya sama).
      if (!(path in map)) map[path] = t.label;
    }
  }
  return map;
})();

function titleCase(segment: string): string {
  const s = segment.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Label tab untuk sebuah pathname. Cocokkan ke tile dulu, baru tebak dari URL. */
export function tabLabel(pathname: string): string {
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  if (path === "/") return HOME_TAB.label;
  // Halaman modul (/kas-bank, /pos, …) — pakai nama modul, bukan tebakan slug.
  const asModule = MODULE_LABEL[path.slice(1)];
  if (asModule && !path.includes("/", 1)) return asModule;
  if (TILE_LABEL[path]) return TILE_LABEL[path];

  const parts = path.split("/").filter(Boolean);
  // Segmen id (uuid / angka) tidak berguna sebagai label — pakai induknya.
  const isId = (s: string) => /^[0-9a-f-]{8,}$/i.test(s) || /^\d+$/.test(s);
  const useful = parts.filter((p) => !isId(p));
  // Setelah id dibuang, path-nya bisa jadi cocok tile (mis. /klinik/antrian/<uuid>).
  const stripped = "/" + useful.join("/");
  if (stripped !== path && TILE_LABEL[stripped]) return TILE_LABEL[stripped];

  const last = useful[useful.length - 1] ?? parts[0];

  // Halaman "baru" ambil konteks induknya: /pembelian/baru → "Pembelian baru".
  // Kalau induknya sebuah tile (bukan halaman modul), pakai nama tile-nya supaya
  // slug mentah tidak bocor ke label: /pos/sku/baru → "Barang & Jasa baru".
  if (last === "baru" && useful.length > 1) {
    const parentPath = "/" + useful.slice(0, -1).join("/");
    const parentIsModule = useful.length === 2 && !!MODULE_LABEL[useful[0]];
    const parent = !parentIsModule && TILE_LABEL[parentPath]
      ? TILE_LABEL[parentPath]
      : titleCase(useful[useful.length - 2]);
    return `${parent} baru`;
  }
  return titleCase(last);
}

/** Buka tab (idempoten). Tab Dashboard selalu bertahan di posisi pertama. */
export function openTab(tabs: PageTab[], tab: PageTab, max = MAX_TABS): PageTab[] {
  if (tab.href === HOME_TAB.href) return tabs;
  if (tabs.some((t) => t.href === tab.href)) return tabs;

  const next = [...tabs, tab];
  if (next.length <= max) return next;
  // Buang yang terlama, jangan pernah tab yang baru saja dibuka.
  return next.slice(next.length - max);
}

/** Tutup tab. Dashboard tidak bisa ditutup. */
export function closeTab(tabs: PageTab[], href: string): PageTab[] {
  if (href === HOME_TAB.href) return tabs;
  return tabs.filter((t) => t.href !== href);
}

/**
 * Tab mana yang harus aktif setelah `href` ditutup — dihitung dari daftar
 * SEBELUM penutupan. Pindah ke tetangga kanan, kalau tidak ada ke kiri.
 */
export function nextActive(tabs: PageTab[], href: string): string {
  const all = [HOME_TAB, ...tabs.filter((t) => t.href !== HOME_TAB.href)];
  const i = all.findIndex((t) => t.href === href);
  if (i < 0) return HOME_TAB.href;
  return (all[i + 1] ?? all[i - 1] ?? HOME_TAB).href;
}
