// Peran "Admin Online" (kode ADMIN_ONLINE), permintaan Andri 17-18 Nov 2026:
// akun yang HANYA boleh memasukkan penjualan marketplace (Impor pesanan Shopee).
//
// Satu sumber kebenaran untuk sisi aplikasi: kode, label, halaman rumah, dan daftar jalur yang boleh dibuka.
// Ini LANGIT-LANGIT: tidak ada aturan Akses Grup, akses khusus akun, atau modul yang bisa melebarkannya
// (bolehBukaPath mengembalikan hasil fungsi ini untuk peran ini sebelum aturan lain dibaca).
// Penegakan sebenarnya berlapis: middleware + layout + server action (file ini), lalu database (pagar baca/tulis
// RLS + pemicu + gerbang di post_online_order, migrasi 20261130100100) yang tetap menolak walau lapisan aplikasi dilewati.

export const ADMIN_ONLINE = "ADMIN_ONLINE";
export const LABEL_ADMIN_ONLINE = "Admin Online";
/** Satu-satunya layar kerja peran ini (juga tujuan setelah login). */
export const RUMAH_ADMIN_ONLINE = "/penjualan/online/impor";

/** Jalur yang boleh dibuka (cocok persis, tanpa query/hash). Login/auth ditangani middleware sebelum pemeriksaan peran. */
const JALUR_ADMIN_ONLINE: readonly string[] = [RUMAH_ADMIN_ONLINE];
const JALUR_BEBAS_SESI: readonly string[] = ["/login", "/auth"];

export function isAdminOnline(role: string | null | undefined): boolean {
  return role === ADMIN_ONLINE;
}

/** Label tampilan peran; peran lain mengembalikan kodenya. */
export function labelPeran(role: string): string {
  return role === ADMIN_ONLINE ? LABEL_ADMIN_ONLINE : role;
}

/** Bersihkan URL jadi jalur baku: tanpa query/hash, % didekode, garis miring ganda/akhir dibuang, huruf kecil. null = tidak bisa dipastikan. */
export function jalurBaku(path: string): string | null {
  let p = path.split(/[?#]/)[0] ?? "";
  try { p = decodeURIComponent(p); } catch { return null; }
  if (/[\\\u0000-\u001f]/.test(p)) return null;
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p.toLowerCase();
}

/** Boleh buka jalur ini? Daftar putih persis: hanya layar impor (dan login/auth agar sesi bisa dimulai/diakhiri). */
export function adminOnlineBolehBuka(path: string): boolean {
  const p = jalurBaku(path);
  if (p === null) return false;
  if (JALUR_BEBAS_SESI.some(x => p === x || p.startsWith(x + "/"))) return true;
  return JALUR_ADMIN_ONLINE.includes(p);
}

/** Daftar putih endpoint API yang boleh dipakai (cocok persis). Selain ini ditolak di route masing-masing. */
export const API_ADMIN_ONLINE: readonly string[] = ["/api/version"];

/** Semua peran yang boleh dipilih/dikenali di Pengaturan > Pengguna (peran Akses Grup + Admin Online). Urutan tampil. */
export const PERAN_AKUN = ["OWNER", "ADMIN", "FINANCE", "DOCTOR", "STAFF", ADMIN_ONLINE] as const;
/** Peran yang wajib punya penugasan cabang saat akun dibuat/diubah (database menegakkan hal yang sama). */
export const PERAN_WAJIB_CABANG: readonly string[] = ["STAFF", "DOCTOR", ADMIN_ONLINE];
