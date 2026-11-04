// Arsip antrean klinik (Andri 4 Nov 2026): kunjungan yang menumpuk disembunyikan dari daftar kerja tanpa dihapus.
// Satu tempat untuk aturan peran dan pesan, dipakai layar Antrian dan server action-nya. Penegak sebenarnya ada di
// database (RPC clinic_archive_visit / clinic_unarchive_visit memeriksa peran lagi); ini hanya menyembunyikan tombol dan
// menolak lebih awal dengan pesan jelas.

export const PERAN_ARSIP = ["OWNER", "ADMIN"] as const;
export const ALASAN_ARSIP_MIN = 5;
export const ALASAN_ARSIP_MAX = 500;
export const BATAS_DIARSIPKAN = 200;
// Arsip PAKSA (Andri 4 Nov 2026, lanjutan PR #438): hanya OWNER, alasan >= 5 huruf/angka, kata konfirmasi, dan kotak persetujuan.
// Tetap tidak melewati invoice/pembayaran/DP/refund/racikan terjual/rawat inap/riwayat impor (ditolak database).
export const PERAN_PAKSA_ARSIP = ["OWNER"] as const;
export const KATA_KONFIRMASI_PAKSA = "PAKSA";
export const ALASAN_PAKSA_MIN_BERMAKNA = 5;
export const PESAN_PAKSA_PERAN = "Hanya pemilik yang boleh memaksa arsip antrean.";
export const PERINGATAN_PAKSA_ARSIP =
  "Peringatan: kunjungan ini akan disembunyikan walau status/rekam medisnya sudah berisi data (isi klinis, item tertunda, persetujuan). " +
  "Datanya TIDAK dihapus dan dapat dipulihkan dari tab Diarsipkan. Kunjungan yang sudah punya invoice, pembayaran, uang muka, refund, racikan terjual atau rawat inap tetap tidak dapat diarsipkan.";

export function bolehArsip(profile: { role?: string | null; is_active?: boolean | null } | null | undefined): boolean {
  return !!profile?.is_active && (PERAN_ARSIP as readonly string[]).includes(profile.role ?? "");
}

export function bolehPaksaArsip(profile: { role?: string | null; is_active?: boolean | null } | null | undefined): boolean {
  return !!profile?.is_active && (PERAN_PAKSA_ARSIP as readonly string[]).includes(profile.role ?? "");
}

/** Jumlah huruf/angka pada alasan (tanda baca dan spasi tidak dihitung): alasan paksa harus bermakna. */
export function hurufBermakna(reason: string): number {
  return (reason.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

/** Pesan galat RPC tanpa awalan kode teknis (mis. "ARCHIVE_BLOCKED: ..."). */
export function pesanArsip(message: string | null | undefined): string {
  const mentah = String(message ?? "");
  if (/lock timeout|55P03/i.test(mentah)) return "Kunjungan sedang diproses pengguna lain. Tunggu sebentar lalu coba lagi.";
  const bersih = mentah.replace(/^\s*[A-Z][A-Z_]+:\s*/, "").trim();
  return bersih || "Arsip antrean gagal diproses. Muat ulang halaman lalu coba lagi.";
}
