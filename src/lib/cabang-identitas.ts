// Identitas cabang untuk kop dokumen cetak (rekam medis): alamat, telepon, logo.
// Aturan di sini SAMA dengan batasan database (branches_identitas_cek + update_branch_identity): database tetap penentu akhir.

export const ALAMAT_MIN = 3;
export const ALAMAT_MAX = 200;
export const TELEPON_MIN = 3;
export const TELEPON_MAX = 30;
export const LOGO_MAKS_BYTE = 1024 * 1024; // 1 MB
export const LOGO_BUCKET = "dokumen";
export const LOGO_AWALAN = "cabang-logo";
export const LOGO_TIPE = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
export const LOGO_ACCEPT = "image/png,image/jpeg,image/webp";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TELEPON_KARAKTER = /^[0-9+()./, -]+$/;
const KONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Spasi berulang/baris baru menjadi satu spasi; kosong = tidak diisi (null). */
export function rapikanTeks(v: unknown): string | null {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

export function validasiAlamat(v: string | null): string | null {
  if (v === null) return null;
  if (v.length < ALAMAT_MIN || v.length > ALAMAT_MAX || KONTROL.test(v)) return `Alamat cabang ${ALAMAT_MIN} sampai ${ALAMAT_MAX} karakter`;
  return null;
}

export function validasiTelepon(v: string | null): string | null {
  if (v === null) return null;
  if (v.length < TELEPON_MIN || v.length > TELEPON_MAX || !TELEPON_KARAKTER.test(v)) {
    return `Telepon cabang ${TELEPON_MIN} sampai ${TELEPON_MAX} karakter: angka, spasi, plus, kurung, titik, koma, garis miring, atau tanda minus`;
  }
  return null;
}

/** Pemeriksaan berkas logo di browser SEBELUM diunggah. Mengembalikan pesan galat atau null. */
export function validasiBerkasLogo(f: { type: string; size: number }): string | null {
  if (!(f.type in LOGO_TIPE)) return "Logo harus berformat PNG, JPG, atau WEBP";
  if (f.size <= 0) return "Berkas logo kosong";
  if (f.size > LOGO_MAKS_BYTE) return "Logo maksimal 1 MB";
  return null;
}

export function ekstensiLogo(mime: string): string | null {
  return (LOGO_TIPE as Record<string, string>)[mime] ?? null;
}

/** Nama berkas unik per unggahan (tanpa menimpa; logo lama dibersihkan setelah simpan berhasil). */
export function jalurLogoBaru(branchId: string, mime: string, stempel: number, acak: string): string | null {
  const ext = ekstensiLogo(mime);
  if (!ext || !UUID.test(branchId)) return null;
  const rand = acak.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "x";
  return `${LOGO_AWALAN}/${branchId.toLowerCase()}/${stempel}-${rand}.${ext}`;
}

/** Jalur sah milik cabang ini (sama dengan batasan database). */
export function jalurLogoSah(branchId: string, path: string): boolean {
  if (!UUID.test(branchId)) return false;
  const re = new RegExp(`^${LOGO_AWALAN}/${branchId.toLowerCase()}/[a-z0-9._-]{1,120}\\.(png|jpe?g|webp)$`, "i");
  return re.test(path);
}

export type IdentitasCabang = { name: string | null; alamat: string | null; telepon: string | null; logoUrl: string | null };

/** Satu baris "alamat · telepon" untuk kop; kosong bila keduanya belum diisi. */
export function barisKontakKop(i: Pick<IdentitasCabang, "alamat" | "telepon"> | null | undefined): string {
  const a = i?.alamat?.trim() || "";
  const t = i?.telepon?.trim() || "";
  return [a, t ? `Telp. ${t}` : ""].filter(Boolean).join(" · ");
}
