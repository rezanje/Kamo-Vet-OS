/** J01: koreksi faktur grosir (termasuk yang sudah dibayar) oleh OWNER atau FINANCE aktif. Database memeriksa ulang. */
export const PERAN_KOREKSI_GROSIR = ["OWNER", "FINANCE"] as const;

export function bisaKoreksiGrosir(profile: { role?: string | null; is_active?: boolean | null } | null | undefined): boolean {
  return profile?.is_active === true && (PERAN_KOREKSI_GROSIR as readonly string[]).includes(profile.role ?? "");
}
