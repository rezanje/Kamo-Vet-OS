// Lupa password mandiri (permintaan tim rekrutmen 24 Nov 2026, pilihan C Reza): karyawan minta link lewat email,
// klik link, lalu membuat password baru sendiri — tanpa menunggu Super Admin.
//
// Alur: link dikirim dengan alur "implicit" Supabase, jadi token pemulihan datang di bagian # alamat
// (tidak pernah terkirim ke server lewat URL) dan bisa dibuka di perangkat lain dari tempat link diminta
// (minta di laptop, buka email di HP). Halaman /login/password-baru membaca token itu sekali lalu menghapusnya
// dari alamat. File ini hanya berisi aturan murni supaya bisa dites tanpa jaringan.

export const PATH_PASSWORD_BARU = "/login/password-baru";
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72; // batas bcrypt Supabase

export const PESAN = {
  terkirim: "Kalau email itu terdaftar, link untuk membuat password baru sudah dikirim. Cek kotak masuk (juga folder Spam/Promosi). Link berlaku 1 jam dan hanya bisa dipakai sekali.",
  emailTidakValid: "Tulis alamat email login dengan benar.",
  emailBukanAsli: "Email ini bukan alamat email asli, jadi tidak bisa menerima link. Hubungi admin Kamo Group untuk reset password.",
  terlaluSering: "Permintaan link terlalu sering. Tunggu beberapa menit, lalu coba lagi.",
  gagalKirim: "Link belum bisa dikirim. Coba lagi beberapa saat lagi, atau hubungi admin Kamo Group.",
  linkTidakBerlaku: "Link sudah tidak berlaku (lewat 1 jam atau sudah pernah dipakai). Minta link baru.",
  passwordPanjang: `Password baru harus ${PASSWORD_MIN}–${PASSWORD_MAX} karakter.`,
  passwordBeda: "Ulangi password baru belum sama.",
  passwordSama: "Password baru tidak boleh sama dengan password lama.",
  passwordLemah: "Password terlalu mudah ditebak. Pakai gabungan huruf dan angka yang lebih panjang.",
  gagalSimpan: "Password baru belum tersimpan. Coba lagi, atau minta link baru.",
} as const;

export type HasilAksi = { ok: boolean; message: string } | null;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Domain cadangan (RFC 2606/6761) tidak pernah menerima email, mis. akun lama "nama@vetos.local".
const DOMAIN_BUKAN_ASLI = /\.(local|localhost|test|invalid|example|internal)$/i;

export function normalEmail(nilai: unknown): string {
  return String(nilai ?? "").trim().toLowerCase();
}

/** null = boleh dikirimi link; selain itu pesan penolakan (hanya dari isian, tidak membuka ada/tidaknya akun). */
export function cekEmail(email: string): string | null {
  if (!email || email.length > 254 || !EMAIL.test(email)) return PESAN.emailTidakValid;
  if (DOMAIN_BUKAN_ASLI.test(email.split("@")[1] ?? "")) return PESAN.emailBukanAsli;
  return null;
}

export function cekPassword(password: string, ulang: string): string | null {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return PESAN.passwordPanjang;
  if (password !== ulang) return PESAN.passwordBeda;
  return null;
}

/** Alamat aplikasi (https://host) dari header permintaan. null = host tidak wajar, jangan kirim link. */
export function asalAplikasi(host: string | null | undefined, proto: string | null | undefined): string | null {
  const h = String(host ?? "").split(",")[0].trim().toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(h)) return null;
  const lokal = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h);
  const p = String(proto ?? "").split(",")[0].trim().toLowerCase();
  return `${lokal && p !== "https" ? "http" : "https"}://${h}`;
}

type GalatAuth = { code?: string | null; status?: number | null; message?: string | null } | null | undefined;

export function pesanGagalKirim(error: GalatAuth): string {
  if (!error) return PESAN.terkirim;
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") return PESAN.terlaluSering;
  return PESAN.gagalKirim;
}

export function pesanGagalSimpan(error: GalatAuth): string {
  if (error?.code === "same_password") return PESAN.passwordSama;
  if (error?.code === "weak_password") return PESAN.passwordLemah;
  if (error?.status === 401 || error?.status === 403 || ["session_not_found", "session_expired", "bad_jwt", "refresh_token_not_found", "refresh_token_already_used"].includes(String(error?.code))) {
    return PESAN.linkTidakBerlaku;
  }
  return PESAN.gagalSimpan;
}

export type TokenPemulihan =
  | { status: "ok"; accessToken: string; refreshToken: string }
  | { status: "galat"; message: string }
  | { status: "kosong" };

/** Membaca bagian # alamat yang dikirim Supabase setelah link email diklik. */
export function bacaTokenPemulihan(hash: string): TokenPemulihan {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  if (p.get("error") || p.get("error_code") || p.get("error_description")) return { status: "galat", message: PESAN.linkTidakBerlaku };
  const accessToken = p.get("access_token") ?? "";
  const refreshToken = p.get("refresh_token") ?? "";
  if (p.get("type") !== "recovery" || !accessToken || !refreshToken) return { status: "kosong" };
  return { status: "ok", accessToken, refreshToken };
}

/** Bagian # yang perlu diteruskan dari halaman lain (mis. /login bila Supabase jatuh ke Site URL) ke halaman password baru. */
export function hashPemulihan(hash: string): boolean {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  return p.get("type") === "recovery" || (p.has("error_code") && /otp|expired|recovery/i.test(`${p.get("error_code")} ${p.get("error_description")}`));
}
