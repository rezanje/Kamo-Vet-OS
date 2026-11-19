// Jabatan HRIS dan role akun login disimpan terpisah: mengganti jabatan TIDAK mengubah menu/akses login.
// Modul ini hanya MENANDAI akun yang role-nya tidak lazim untuk jabatan klinisnya (Dokter/Paramedis/Groomer),
// supaya HR/Super Admin tahu harus merapikan role di Pengaturan → Pengguna. Tidak mengubah apa pun.
// Jabatan di luar kelompok klinis (manajer, admin, CEO, dsb.) sengaja tidak dinilai.

export type PeranSaran = "DOCTOR" | "STAFF";

const LABEL_PERAN: Record<string, string> = {
  OWNER: "Super Admin", ADMIN: "Admin", FINANCE: "Finance", DOCTOR: "Dokter", STAFF: "Staf", ADMIN_ONLINE: "Admin Online",
};

export function labelPeranAkun(role: string): string {
  return LABEL_PERAN[role] ?? role;
}

/** Role akun yang lazim untuk jabatan klinis; null = jabatan tidak dinilai. */
export function peranSaranJabatan(jabatan: string | null | undefined): PeranSaran | null {
  const j = (jabatan ?? "").toLowerCase();
  if (!j.trim()) return null;
  if (/\bdokter\b/.test(j)) return "DOCTOR";
  if (/\bparamedis\b|\bgroomer\b/.test(j)) return "STAFF";
  return null;
}

export type KetidakcocokanPeran = { jabatan: string; sekarang: string; saran: PeranSaran };

/** Mengembalikan ketidakcocokan bila role akun berbeda dari role lazim jabatan klinisnya. */
export function cekPeranVsJabatan(jabatan: string | null | undefined, role: string | null | undefined): KetidakcocokanPeran | null {
  const saran = peranSaranJabatan(jabatan);
  if (!saran || !role || role === saran) return null;
  return { jabatan: String(jabatan).trim(), sekarang: role, saran };
}

/** Kalimat peringatan siap tampil, tanpa istilah teknis. */
export function pesanPeranVsJabatan(m: KetidakcocokanPeran): string {
  return `Jabatan ${m.jabatan}, tapi akun loginnya masih ber-role ${labelPeranAkun(m.sekarang)}. `
    + `Menu yang muncul saat login mengikuti role akun, bukan jabatan — ubah role akun ke ${labelPeranAkun(m.saran)} di Pengaturan → Pengguna.`;
}
