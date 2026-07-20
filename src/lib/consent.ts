// Form persetujuan (consent) — render template & status. Pure, dipakai server action + view.

export type ConsentStatus = "belum_ttd" | "sudah_ttd";

export type ConsentVars = {
  nama_pemilik: string;
  nama_hewan: string;
  jenis_hewan: string;
  tindakan: string;
  dokter: string;
  cabang: string;
  tanggal: string;
};

export const PLACEHOLDERS: (keyof ConsentVars)[] = [
  "nama_pemilik", "nama_hewan", "jenis_hewan", "tindakan", "dokter", "cabang", "tanggal",
];

// Ganti {placeholder} dgn nilainya. Placeholder tak dikenal dibiarkan apa adanya supaya
// salah ketik kelihatan di dokumen, bukan hilang diam-diam.
export function renderTemplate(isi: string, vars: Partial<ConsentVars>): string {
  return isi.replace(/\{(\w+)\}/g, (full, key: string) => {
    const v = vars[key as keyof ConsentVars];
    return v != null && v !== "" ? String(v) : full;
  });
}

export const STATUS_LABEL: Record<ConsentStatus, string> = {
  belum_ttd: "Belum TTD",
  sudah_ttd: "Sudah TTD",
};

// kelas badge existing di globals.css: r = merah, g = hijau.
export const STATUS_BADGE: Record<ConsentStatus, string> = {
  belum_ttd: "r",
  sudah_ttd: "g",
};

// TTD sah kalau ada gambarnya DAN nama penanda tangan terisi.
export function canSign(signerName: string, signatureData: string): boolean {
  return signerName.trim().length > 0 && signatureData.trim().length > 0;
}

// Rawat inap: peringatkan kalau tidak ada satu pun consent bertanda tangan.
export function hasSignedConsent(rows: { status: string }[]): boolean {
  return rows.some((r) => r.status === "sudah_ttd");
}

// Template yang berlaku utk cabang tsb: khusus cabang itu + yang berlaku semua cabang.
export function templatesForBranch<T extends { branch_id: string | null; is_active: boolean }>(
  templates: T[],
  branchId: string | null,
): T[] {
  return templates.filter((t) => t.is_active && (t.branch_id == null || t.branch_id === branchId));
}
