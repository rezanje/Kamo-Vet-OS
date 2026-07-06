// Status absensi harian (pure) — dipakai /me untuk tombol Clock In / Clock Out.
export type AttendanceRow = { jam_masuk?: string | null; jam_pulang?: string | null };
export type AttendanceState = "not_in" | "in" | "done";
export type AttendanceAction = "clockIn" | "clockOut" | null;

export function attendanceState(row: AttendanceRow | null): AttendanceState {
  if (!row || !row.jam_masuk) return "not_in";
  if (!row.jam_pulang) return "in";
  return "done";
}

export function nextAction(state: AttendanceState): AttendanceAction {
  if (state === "not_in") return "clockIn";
  if (state === "in") return "clockOut";
  return null;
}
