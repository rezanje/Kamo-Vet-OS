// Tautan "Kembali" yang mengingat daftar asalnya (permintaan Andri 28 Nov 2026).
//
// Masalah: daftar (mis. Barang & Jasa) menyimpan pencarian/filter/halaman di alamat (?cari=...&hal=2),
// tetapi tautan "Kembali" di halaman detail menunjuk ke alamat polos (/pos/sku), sehingga filter hilang.
// Selain itu area isi (`.ct`) adalah wadah gulir sendiri, jadi posisi gulir tidak dipulihkan browser.
//
// Cara kerja (disimpan per tab di sessionStorage, hilang saat tab ditutup):
// - JejakDaftar (di layout) mencatat alamat lengkap TERAKHIR tiap halaman, dan posisi gulirnya.
// - BackLink hanya MEMBACA catatan itu untuk tautannya sendiri. Menu samping, tab halaman dan Daftar
//   Laporan tidak memakai berkas ini: klik menu tetap membuka daftar baru yang bersih.
import { queryUntukDiingat } from "./menu-last-path";

export const LIST_URL_KEY = "vetos:list-url";
export const LIST_SCROLL_KEY = "vetos:list-scroll";
export const PENDING_SCROLL_KEY = "vetos:pending-scroll";
/** Catatan alamat dianggap basi sesudah ini (kembali dari detail yang dibuka berjam-jam kemudian membuka daftar polos). */
export const LIST_URL_TTL_MS = 2 * 60 * 60 * 1000;
export const MAX_LIST_URLS = 80;
export const MAX_SCROLL_ENTRIES = 40;
const PENDING_TTL_MS = 15_000;

export type BackStore = Pick<Storage, "getItem" | "setItem">;

type UrlEntry = { u: string; t: number };
type ScrollEntry = { y: number; t: number };

function readMap<T>(store: BackStore | null | undefined, key: string): Record<string, T> {
  if (!store) return {};
  try {
    const raw = JSON.parse(store.getItem(key) ?? "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, T>) : {};
  } catch {
    return {};
  }
}

function writeMap(store: BackStore, key: string, map: Record<string, { t: number }>, max: number): void {
  const keys = Object.keys(map);
  if (keys.length > max) {
    keys.sort((a, b) => map[a].t - map[b].t);
    for (const k of keys.slice(0, keys.length - max)) delete map[k];
  }
  try {
    store.setItem(key, JSON.stringify(map));
  } catch {
    // Penyimpanan penuh/ditolak: abaikan, navigasi tetap jalan seperti biasa.
  }
}

/** Path internal polos (tanpa query/hash/backslash) selain beranda. */
function pathAman(path: string): boolean {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//") && !/[?#\\]/.test(path) && path !== "/";
}

/** Tambahan di luar daftar bersama: tanda "transaksi baru selesai"/peringatan sekali tampil tidak boleh dihidupkan lagi saat kembali. */
const SEKALI_PAKAI_TAMBAHAN = /^(completed_sale_id|draft_used|hpp_sig|hpp_warning|struk|import_success|recover_receipt|sukses|run_id|master_run_id)$/;

/** Kunci halaman: path + query tanpa parameter sekali pakai (pesan sukses/galat dst). */
export function kunciHalaman(pathname: string, search = ""): string {
  const params = new URLSearchParams(queryUntukDiingat(search));
  for (const key of [...new Set(params.keys())]) if (SEKALI_PAKAI_TAMBAHAN.test(key)) params.delete(key);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function rememberListUrl(store: BackStore | null | undefined, pathname: string, search = "", now = Date.now()): void {
  if (!store || !pathAman(pathname)) return;
  const all = readMap<UrlEntry>(store, LIST_URL_KEY);
  all[pathname] = { u: kunciHalaman(pathname, search), t: now };
  writeMap(store, LIST_URL_KEY, all, MAX_LIST_URLS);
}

/**
 * Tujuan tautan Kembali. `href` adalah tujuan asli (cadangan). Dipakai alamat terakhir halaman itu bila:
 * - href polos atau query-nya sudah termuat di alamat tersimpan (tab yang sama), dan
 * - belum basi, dan halaman sekarang bukan halaman itu sendiri.
 * Selain itu href dikembalikan apa adanya.
 */
export function resolveBackHref(store: BackStore | null | undefined, href: string, currentPathname = "", now = Date.now()): string {
  if (!store || typeof href !== "string" || /[#\\]/.test(href)) return href;
  const [path, ...rest] = href.split("?");
  if (!pathAman(path) || path === currentPathname) return href;
  const saved = readMap<UrlEntry>(store, LIST_URL_KEY)[path];
  if (!saved || typeof saved.u !== "string" || typeof saved.t !== "number") return href;
  if (now - saved.t > LIST_URL_TTL_MS || now < saved.t) return href;
  if (!saved.u.startsWith(`${path}?`) || /[#\\]/.test(saved.u)) return href;
  const wanted = new URLSearchParams(rest.join("?"));
  const have = new URLSearchParams(saved.u.slice(path.length + 1));
  for (const [key, value] of wanted) if (!have.getAll(key).includes(value)) return href;
  return saved.u;
}

export function rememberScroll(store: BackStore | null | undefined, url: string, y: number, now = Date.now()): void {
  if (!store || typeof url !== "string" || !url.startsWith("/") || !Number.isFinite(y)) return;
  const all = readMap<ScrollEntry>(store, LIST_SCROLL_KEY);
  if (y <= 0) delete all[url];
  else all[url] = { y: Math.round(y), t: now };
  writeMap(store, LIST_SCROLL_KEY, all, MAX_SCROLL_ENTRIES);
}

export function readScroll(store: BackStore | null | undefined, url: string): number | null {
  const entry = readMap<ScrollEntry>(store, LIST_SCROLL_KEY)[url];
  return entry && typeof entry.y === "number" && entry.y > 0 ? entry.y : null;
}

/** BackLink menandai tujuannya supaya JejakDaftar memulihkan gulir begitu halaman itu tampil. */
export function markPendingScroll(store: BackStore | null | undefined, url: string, now = Date.now()): void {
  if (!store) return;
  try {
    store.setItem(PENDING_SCROLL_KEY, JSON.stringify({ u: url, t: now }));
  } catch {
    // diabaikan
  }
}

/** Sekali pakai: true bila tanda menunjuk alamat ini dan masih baru. */
export function takePendingScroll(store: (BackStore & Partial<Pick<Storage, "removeItem">>) | null | undefined, url: string, now = Date.now()): boolean {
  if (!store) return false;
  let pending: { u?: unknown; t?: unknown } | null = null;
  try {
    pending = JSON.parse(store.getItem(PENDING_SCROLL_KEY) ?? "null");
  } catch {
    pending = null;
  }
  if (!pending) return false;
  try {
    if (store.removeItem) store.removeItem(PENDING_SCROLL_KEY);
    else store.setItem(PENDING_SCROLL_KEY, "null");
  } catch {
    // diabaikan
  }
  return pending.u === url && typeof pending.t === "number" && now - pending.t <= PENDING_TTL_MS && now >= pending.t;
}

type Raf = (cb: () => void) => unknown;

/**
 * Pulihkan gulir `y` pada wadah isi. Isi halaman bisa tiba belakangan (streaming), jadi coba tiap frame
 * sampai cukup tinggi, lalu pastikan menetap. Berhenti bila pengguna menggulir sendiri atau lewat batas waktu.
 * Mengembalikan fungsi pembatal.
 */
export function pulihkanGulir(
  getRoot: () => { scrollTop: number; scrollHeight: number; clientHeight: number } | null,
  y: number,
  opts: { maxMs?: number; now?: () => number; raf?: Raf; target?: Pick<EventTarget, "addEventListener" | "removeEventListener">; onDone?: () => void } = {},
): () => void {
  const maxMs = opts.maxMs ?? 3000;
  const now = opts.now ?? (() => performance.now());
  const raf: Raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
  const target = opts.target ?? (typeof document !== "undefined" ? document : null);
  const start = now();
  const events = ["wheel", "touchstart", "keydown", "mousedown"];
  let stopped = false;
  let stable = 0;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    for (const name of events) target?.removeEventListener(name, cancel, true);
    opts.onDone?.();
  };
  function cancel() { finish(); }
  for (const name of events) target?.addEventListener(name, cancel, true);
  const tick = () => {
    if (stopped) return;
    const el = getRoot();
    const lewat = now() - start > maxMs;
    if (el) {
      const max = el.scrollHeight - el.clientHeight;
      if (max >= y - 1) {
        el.scrollTop = y;
        stable = Math.abs(el.scrollTop - y) <= 2 ? stable + 1 : 0;
        if (stable >= 3) return finish();
      } else if (lewat) {
        el.scrollTop = Math.max(0, max);
        return finish();
      }
    }
    if (lewat) return finish();
    raf(tick);
  };
  raf(tick);
  return finish;
}
