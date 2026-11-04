// Arsip antrean klinik (Andri 4 Nov 2026): kunjungan yang menumpuk disembunyikan dari daftar kerja tanpa dihapus.
// Satu tempat untuk aturan peran dan pesan, dipakai layar Antrian dan server action-nya. Penegak sebenarnya ada di
// database (RPC clinic_archive_visit / clinic_unarchive_visit memeriksa peran lagi); ini hanya menyembunyikan tombol dan
// menolak lebih awal dengan pesan jelas.

export const PERAN_ARSIP = ["OWNER", "ADMIN"] as const;
export const ALASAN_ARSIP_MIN = 5;
export const ALASAN_ARSIP_MAX = 500;
export const BATAS_DIARSIPKAN = 200;

export function bolehArsip(profile: { role?: string | null; is_active?: boolean | null } | null | undefined): boolean {
  return !!profile?.is_active && (PERAN_ARSIP as readonly string[]).includes(profile.role ?? "");
}

/** Pesan galat RPC tanpa awalan kode teknis (mis. "ARCHIVE_BLOCKED: ..."). */
export function pesanArsip(message: string | null | undefined): string {
  const bersih = String(message ?? "").replace(/^\s*[A-Z][A-Z_]+:\s*/, "").trim();
  return bersih || "Arsip antrean gagal diproses. Muat ulang halaman lalu coba lagi.";
}
