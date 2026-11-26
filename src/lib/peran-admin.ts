// Peran "Admin Umum" (kode ADMIN_UMUM), permintaan Andri 26 Nov 2026: admin umum yang membantu pekerjaan finance.
//
// Satu sumber kebenaran sisi aplikasi: kode, label, dan cara memperlakukannya terhadap ADMIN.
// ATURAN: ADMIN_UMUM berperilaku SAMA seperti ADMIN di setiap tempat yang menyebut ADMIN (bawaan: semua modul, semua cabang), tetapi dikelola
// sebagai peran TERPISAH di Pengaturan > Akses Grup supaya hak aksesnya bisa diatur sendiri tanpa menyentuh ADMIN. Ia TIDAK setara OWNER:
// semua daftar "OWNER + ADMIN" tetap memuat OWNER seperti semula; peran ini hanya ditambahkan di sebelah ADMIN.
// Di database aturan yang sama ditegakkan oleh migrasi 20261214100100_admin_umum_role.sql (admin_umum_private.terapkan_semua).
//
// Tes pemindai (src/lib/__tests__/peran-admin-sebaran.test.ts) menggagalkan build bila ada daftar peran yang menyebut "ADMIN" tetapi tidak memuat
// "ADMIN_UMUM" dan tidak tercantum di daftar pengecualian tertulis.

export const ADMIN_UMUM = "ADMIN_UMUM";
export const LABEL_ADMIN_UMUM = "Admin Umum";
/** Kedua peran setingkat "admin" (bawaan sama). OWNER bukan bagiannya. */
export const PERAN_ADMIN = ["ADMIN", ADMIN_UMUM] as const;

/** ADMIN atau ADMIN_UMUM (bukan OWNER). Dipakai menggantikan perbandingan `role === "ADMIN"`. */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === ADMIN_UMUM;
}

/**
 * Peran penyetuju (approval_rules.penyetuju_role hanya OWNER/ADMIN/FINANCE): akun ADMIN_UMUM memakai antrean persetujuan milik ADMIN,
 * seperti ADMIN. Peran lain mengembalikan dirinya sendiri.
 */
export function peranPenyetujuEfektif(role: string): string {
  return role === ADMIN_UMUM ? "ADMIN" : role;
}
