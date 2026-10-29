// Pencarian & penyaringan daftar karyawan HRIS. Murni dan dites di
// __tests__/karyawan-filter.test.ts supaya layar daftar tidak perlu dites ulang.
import { clinicalRoles, type ClinicalRole } from "./clinical-staff";

/** Pencarian tahan huruf besar/kecil, spasi berlebih, dan tanda diakritik (é, ü, ñ). */
export function normalisasiCari(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Grup jabatan klinis memakai aturan yang sama dengan pemilih petugas di klinik. */
export const GRUP_JABATAN: readonly { id: string; label: string; role: ClinicalRole | null }[] = [
  { id: "dokter", label: "Dokter", role: "doctor" },
  { id: "paramedis", label: "Paramedis", role: "paramedic" },
  { id: "groomer", label: "Groomer", role: "groomer" },
  { id: "lainnya", label: "Lainnya", role: null },
];

/** Label peran klinis untuk layar HR: "Dokter", "Groomer", "Dokter + Groomer", atau "Lainnya". */
export function labelPeranKlinis(jabatan: string | null): string {
  const peran = clinicalRoles(jabatan);
  const label = GRUP_JABATAN.filter((item) => item.role && peran.includes(item.role)).map((item) => item.label);
  return label.length ? label.join(" + ") : "Lainnya";
}

export function cocokGrupJabatan(jabatan: string | null, grup: string): boolean {
  const pilihan = GRUP_JABATAN.find((item) => item.id === grup);
  if (!pilihan) return true;
  const peran = clinicalRoles(jabatan);
  return pilihan.role ? peran.includes(pilihan.role) : peran.length === 0;
}

export type KaryawanTersaring = {
  nama: string;
  nik?: string | null;
  jabatan?: string | null;
  departemen?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string;
  branch_id?: string | null;
  branchName?: string;
  assignments?: { branch_id: string; branchName?: string }[];
};

export type SaringanKaryawan = { cari?: string; cabang?: string; grup?: string };

/** Satu kotak cari: nama, NIK, jabatan, departemen, no HP, email, dan nama cabang. */
export function saringKaryawan<T extends KaryawanTersaring>(rows: T[], saringan: SaringanKaryawan): T[] {
  const kata = normalisasiCari(saringan.cari ?? "");
  const cabang = (saringan.cabang ?? "").trim();
  const grup = (saringan.grup ?? "").trim();
  return rows.filter((row) => {
    const penugasan = row.assignments ?? [];
    if (cabang && row.branch_id !== cabang && !penugasan.some((item) => item.branch_id === cabang)) return false;
    if (grup && !cocokGrupJabatan(row.jabatan ?? null, grup)) return false;
    if (!kata) return true;
    const sumber = [row.nama, row.nik, row.jabatan, row.departemen, row.phone, row.email, row.status, row.branchName,
      ...penugasan.map((item) => item.branchName)];
    return sumber.some((nilai) => nilai && normalisasiCari(String(nilai)).includes(kata));
  });
}
