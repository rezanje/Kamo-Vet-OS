// Karyawan & shift yang tampil di papan jadwal satu cabang. Dipakai halaman /hris/jadwal dan aksi
// "Salin dari bulan lalu" supaya yang disalin persis yang terlihat di papan.
import { saringanPenugasanAktif } from "./employee-assignment";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type KaryawanJadwal = { id: string; nama: string; jabatan: string | null };
export type ShiftJadwalCabang = {
  id: string; nama: string; warna: string; is_libur: boolean; jam_masuk: string | null; jam_pulang: string | null;
};

export async function bacaPapanJadwal(supabase: AnyClient, cabang: string, hariIni: string): Promise<{
  karyawan: KaryawanJadwal[]; shifts: ShiftJadwalCabang[];
}> {
  const [{ data: empData }, { data: shiftData }, { data: assignmentData }] = await Promise.all([
    supabase.from("employees").select("id, nama, jabatan, branch_id").eq("status", "Aktif")
      .order("nama"),
    supabase.from("work_shifts").select("id, nama, warna, is_libur, jam_masuk, jam_pulang, branch_id")
      .eq("is_active", true).or(`branch_id.is.null,branch_id.eq.${cabang}`).order("is_libur").order("jam_masuk"),
    supabase.from("employee_branch_assignments").select("employee_id, branch_id").eq("branch_id", cabang)
      .lte("effective_date", hariIni).or(saringanPenugasanAktif(hariIni)),
  ]);

  const assignedIds = new Set(((assignmentData ?? []) as { employee_id: string }[]).map((a) => a.employee_id));
  const karyawan = ((empData ?? []) as (KaryawanJadwal & { branch_id?: string | null })[])
    .filter((e) => assignedIds.has(e.id) || (!assignmentData?.length && e.branch_id === cabang))
    .map(({ id, nama, jabatan }) => ({ id, nama, jabatan }));
  return { karyawan, shifts: (shiftData ?? []) as ShiftJadwalCabang[] };
}
