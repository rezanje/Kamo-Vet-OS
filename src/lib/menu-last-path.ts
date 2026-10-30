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
  const full = `${pathname}${search && search !== "?" ? (search.startsWith("?") ? search : `?${search}`) : ""}`;
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
