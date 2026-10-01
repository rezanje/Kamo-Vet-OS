export type ShiftJadwal = {
  id: string;
  nama: string;
  jam_masuk: string | null;
  jam_pulang: string | null;
  is_libur: boolean;
  is_active: boolean;
  branch_id: string | null;
};
export type JadwalSaya = {
  id: string;
  tanggal: string;
  shift_id: string;
  updated_at: string;
  shift: ShiftJadwal;
};
export type CabangJadwal = { id: string; name: string; effective_date: string };
export type PengajuanJadwal = {
  id: string;
  employee_id: string;
  branch_id: string;
  tanggal: string;
  old_shift: ShiftJadwal;
  proposed_shift: ShiftJadwal;
  reason: string;
  status: string;
  requested_by: string;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
};
export type DataJadwalSaya = {
  schedules: JadwalSaya[];
  branches: CabangJadwal[];
  shifts: ShiftJadwal[];
  requests: PengajuanJadwal[];
};
export function pilihanCabangJadwal(
  row: { tanggal: string; shift: { branch_id: string | null } },
  branches: CabangJadwal[],
) {
  return branches.filter(
    (b) =>
      b.effective_date <= row.tanggal &&
      (!row.shift.branch_id || row.shift.branch_id === b.id),
  );
}
export function pilihanShiftJadwal<
  T extends { id: string; branch_id: string | null; is_active: boolean },
>(row: { shift_id: string }, shifts: T[], branch: string): T[] {
  return branch
    ? shifts.filter(
        (s) =>
          s.is_active &&
          s.id !== row.shift_id &&
          (!s.branch_id || s.branch_id === branch),
      )
    : [];
}
export function pesanJadwal(error: { code?: string; message?: string }) {
  if (
    error.code === "PGRST202" ||
    error.code === "42P01" ||
    error.code === "42703"
  )
    return "Fitur pengajuan jadwal belum aktif. Hubungi admin sistem.";
  if (error.code === "40P01" || error.code === "40001")
    return "Jadwal sedang berubah. Muat ulang lalu coba kembali.";
  if (error.message?.startsWith("JADWAL:"))
    return error.message.replace(/^JADWAL:\s*/, "");
  return "Pengajuan jadwal gagal disimpan. Muat ulang atau hubungi HR.";
}

export function bolehUbahShift(
  role: string,
  branch: string | null,
  allowed: string[],
) {
  return (
    role === "OWNER" ||
    (role === "ADMIN" && branch !== null && allowed.includes(branch))
  );
}
