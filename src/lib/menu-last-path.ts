// Ingat halaman terakhir per modul (mis. laporan yang sedang dibuka beserta filternya),
// supaya pindah modul lalu kembali tidak melempar pengguna ke halaman utama modul.
// Disimpan per tab browser (sessionStorage), bukan per akun: aman dan hilang saat tab ditutup.

export const LAST_PATH_KEY = "vetos:last-path";

type Store = Pick<Storage, "getItem" | "setItem">;

/** Modul = segmen pertama path ("/laporan/penjualan-rinci" → "laporan"). Dashboard tidak diingat. */
export function moduleOf(pathname: string): string | null {
  const seg = pathname.split("/")[1] ?? "";
  return seg ? seg : null;
}

function read(store: Store | null | undefined): Record<string, string> {
  if (!store) return {};
  try {
    const raw = JSON.parse(store.getItem(LAST_PATH_KEY) ?? "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Hanya path internal milik modul itu sendiri yang boleh disimpan/dipakai. */
export function isSafeModulePath(moduleId: string, path: string): boolean {
  if (typeof path !== "string" || !path.startsWith(`/${moduleId}`)) return false;
  if (path.startsWith("//") || path.includes("\\")) return false;
  const rest = path.slice(moduleId.length + 1);
  return rest === "" || rest.startsWith("/") || rest.startsWith("?");
}

export function rememberPath(store: Store | null | undefined, pathname: string, search = ""): void {
  const mod = moduleOf(pathname);
  if (!store || !mod) return;
  const query = queryUntukDiingat(search);
  const full = `${pathname}${query ? `?${query}` : ""}`;
  if (!isSafeModulePath(mod, full)) return;
  const all = read(store);
  all[mod] = full;
  try {
    store.setItem(LAST_PATH_KEY, JSON.stringify(all));
  } catch {
    // Penyimpanan penuh/ditolak: abaikan, navigasi tetap jalan normal.
  }
}

/**
 * Tujuan klik menu modul. Kalau modul itu sedang aktif, klik = kembali ke halaman utama
 * modul (perilaku lama). Kalau modul lain, buka halaman terakhirnya bila ada.
 */
export function moduleHref(store: Store | null | undefined, moduleId: string, defaultHref: string, activeModuleId: string): string {
  if (moduleId === activeModuleId) return defaultHref;
  const saved = read(store)[moduleId];
  return saved && isSafeModulePath(moduleId, saved) ? saved : defaultHref;
}

// --- Laporan "dibekukan" di posisi terakhir (permintaan Reza 19 Nov 2026) ---
// Tab halaman dan kotak di Daftar Laporan hanya tahu alamat tanpa filter, sehingga kembali ke
// laporan = laporan kosong lagi. Simpan alamat lengkap terakhir tiap halaman laporan yang sudah
// ditampilkan (`tampil=1`, lihat src/lib/report-gate.ts) beserta filter dan halaman tabelnya,
// lalu pakai saat pengguna kembali ke halaman itu lewat tautan polos.

export const LAST_PAGE_URL_KEY = "vetos:last-page-url";

/** Parameter sekali pakai (pesan sukses/galat, tanda draf terkirim, mode ubah) — jangan ikut diingat. */
const SEKALI_PAKAI = /^(error|info|posted|hapus|edit|entry|koreksi_error|success(_.*)?|request_.*|draft_.*|replace_.*)$/;

/** Query tanpa parameter sekali pakai; "" bila tidak ada yang tersisa. */
export function queryUntukDiingat(search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const key of [...new Set(params.keys())]) if (SEKALI_PAKAI.test(key)) params.delete(key);
  return params.toString();
}

function pathPolos(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !/[?#\\]/.test(path) && path !== "/";
}

export function rememberPageUrl(store: Store | null | undefined, pathname: string, search = ""): void {
  if (!store || !pathPolos(pathname)) return;
  const query = queryUntukDiingat(search);
  // Hanya laporan yang sudah ditampilkan; kunjungan polos tidak menghapus posisi terakhir.
  if (!new URLSearchParams(query).getAll("tampil").includes("1")) return;
  const all = readMap(store, LAST_PAGE_URL_KEY);
  all[pathname] = `${pathname}?${query}`;
  try {
    store.setItem(LAST_PAGE_URL_KEY, JSON.stringify(all));
  } catch {
    // Penyimpanan penuh/ditolak: abaikan, laporan tetap bisa dibuka seperti biasa.
  }
}

/**
 * Alamat tujuan saat kembali ke sebuah halaman laporan. Hanya berlaku untuk tautan polos
 * (tanpa filter); tautan yang sudah membawa filter sendiri (drill-down, konfigurasi tersimpan)
 * tidak diubah.
 */
export function lastPageUrl(store: Store | null | undefined, href: string): string {
  if (!store || !pathPolos(href)) return href;
  const saved = readMap(store, LAST_PAGE_URL_KEY)[href];
  return typeof saved === "string" && saved.startsWith(`${href}?`) && !/[#\\]/.test(saved) ? saved : href;
}

function readMap(store: Store, key: string): Record<string, string> {
  try {
    const raw = JSON.parse(store.getItem(key) ?? "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}
