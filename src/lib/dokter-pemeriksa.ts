// Dokter pemeriksa di antrian (Andri, 17-18 Nov 2026): "antrian poli grooming gaada buat masukin sales dokter yang ngecek".
//
// Di poli Grooming isian tunggal `doctor_id` pada layar antrian berisi GROOMER (`staffForService`), jadi dokter yang memeriksa tidak
// punya tempat. `visits.pemeriksa_id` menampung dokter itu. Poli lain (medis) sudah wajib memilih Dokter, jadi hanya Grooming
// memakai kolom ini. `visits.doctor_id/dokter` TIDAK berubah artinya; "Ubah dokter PJ" tidak disentuh.
//
// Pemeriksa hanya mencatat + mengisi awal slot Dokter di kasir. Tidak pernah menulis baris tagihan, dan hanya mengisi awal bila cabang
// memang sudah mewajibkan dokter pada Grooming (kebijakan komisi tidak bergeser diam-diam).

import { clinicalRoles } from "./clinical-staff";
import { hariIniWIB } from "./tanggal";
import { saringanPenugasanAktif } from "./employee-assignment";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hanya poli Grooming (poli medis sudah punya isian Dokter). */
export function poliPakaiPemeriksa(poli: string | null | undefined): boolean {
  return (poli ?? "").trim().toLowerCase() === "grooming";
}

/** Pilihan layar: hanya jabatan dokter (aturan sama dengan pagar database), urutan daftar dipertahankan. */
export function pilihanPemeriksa<T extends { jabatan: string | null }>(staf: readonly T[]): T[] {
  return staf.filter((orang) => clinicalRoles(orang.jabatan).includes("doctor"));
}

/** Nilai kiriman form -> uuid huruf kecil, atau null (kosong / bukan uuid / poli selain Grooming). */
export function bacaPemeriksaId(nilai: FormDataEntryValue | null | undefined, poli: string | null | undefined): string | null {
  if (!poliPakaiPemeriksa(poli) || typeof nilai !== "string") return null;
  const id = nilai.trim().toLowerCase();
  return UUID.test(id) ? id : null;
}

/**
 * Isian awal slot Dokter di baris kasir. Kunjungan Grooming yang punya pemeriksa DAN cabangnya mewajibkan dokter pada Grooming
 * -> pemeriksa. Selain itu perilaku lama persis (dokter kunjungan; pada Grooming itu id groomer). Kasir tetap bebas mengubah.
 */
export function dokterAwalKasir(k: {
  poli: string | null | undefined; doctorId: string | null | undefined; pemeriksaId: string | null | undefined; groomingDoctorRequired: boolean | null | undefined;
}): string | null {
  if (poliPakaiPemeriksa(k.poli) && k.pemeriksaId && k.groomingDoctorRequired === true) return k.pemeriksaId;
  return k.doctorId ?? null;
}

export type HasilPemeriksa = { ok: true; nama: string } | { ok: false; pesan: string };

/**
 * Pemeriksaan sisi server sebelum menyimpan: karyawan aktif (tidak di Sampah), berjabatan dokter, bertugas di cabang kunjungan.
 * Database mengulang aturan yang sama (trigger b2_guard_visit_pemeriksa); ini hanya memberi pesan yang jelas. Gagal baca = ditolak.
 */
export async function periksaPemeriksa(supabase: AnyClient, id: string, branchId: string): Promise<HasilPemeriksa> {
  const { data: orang, error } = await supabase.from("employees")
    .select("id, nama, jabatan, status, branch_id, trashed_at").eq("id", id).maybeSingle();
  if (error) return { ok: false, pesan: "Dokter pemeriksa belum dapat diperiksa. Coba lagi." };
  if (!orang || orang.status !== "Aktif" || orang.trashed_at) return { ok: false, pesan: "Dokter pemeriksa harus karyawan yang masih aktif." };
  if (!clinicalRoles(orang.jabatan ?? null).includes("doctor")) return { ok: false, pesan: "Dokter pemeriksa harus berjabatan dokter." };
  if (orang.branch_id !== branchId) {
    const hariIni = hariIniWIB();
    const { data: tugas, error: tugasError } = await supabase.from("employee_branch_assignments")
      .select("employee_id").eq("employee_id", id).eq("branch_id", branchId)
      .lte("effective_date", hariIni).or(saringanPenugasanAktif(hariIni));
    if (tugasError) return { ok: false, pesan: "Penugasan dokter pemeriksa belum dapat diperiksa. Coba lagi." };
    if (!((tugas ?? []) as unknown[]).length) return { ok: false, pesan: "Dokter pemeriksa harus bertugas di cabang ini." };
  }
  return { ok: true, nama: String(orang.nama ?? "") };
}

/** Pesan database `PEMERIKSA_*` -> teks ringkas untuk staf (selain itu null: pesan asli dipakai). */
export function pemeriksaBerlaku(pesanDatabase: string | null | undefined): string | null {
  const teks = pesanDatabase ?? "";
  if (teks.includes("PEMERIKSA_BUKAN_DOKTER")) return "Dokter pemeriksa harus berjabatan dokter.";
  if (teks.includes("PEMERIKSA_BUKAN_CABANG")) return "Dokter pemeriksa harus bertugas di cabang ini.";
  if (teks.includes("PEMERIKSA_TIDAK_VALID")) return "Dokter pemeriksa harus karyawan yang masih aktif.";
  if (teks.includes("PEMERIKSA_TERKUNCI")) return "Dokter pemeriksa tidak dapat diganti karena kunjungan sudah memiliki tagihan atau diarsipkan.";
  return null;
}

/** Nama pemeriksa untuk header Rekam Medis. Gagal baca / tidak ada = null (baris tidak tampil), tidak pernah menggagalkan halaman. */
export async function bacaNamaPemeriksa(supabase: AnyClient, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  try {
    const { data, error } = await supabase.from("employees").select("nama").eq("id", id).maybeSingle();
    if (error) return null;
    return String(data?.nama ?? "").trim() || null;
  } catch {
    return null;
  }
}
