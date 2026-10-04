import { geserTanggal } from "./jadwal-kalender";
import { tanggalWIB } from "./tanggal";
export type SesiAbsensi = {
  id: string;
  tanggal: string;
  jam_masuk: string | null;
  jam_pulang: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  branch_id: string | null;
  is_void: boolean;
  updated_at?: string;
};
export function menitSesi(
  row: Pick<SesiAbsensi, "checked_in_at" | "checked_out_at">,
): number | null {
  if (!row.checked_in_at || !row.checked_out_at) return null;
  const delta =
    new Date(row.checked_out_at).getTime() -
    new Date(row.checked_in_at).getTime();
  return Number.isFinite(delta) && delta >= 0
    ? Math.floor(delta / 60000)
    : null;
}
export function pilihSesiAbsensi(
  opens: SesiAbsensi[],
  today: SesiAbsensi | null,
  now: string,
) {
  const date = tanggalWIB(now);
  const row = opens[0] ?? (today && !today.is_void ? today : null);
  const correction =
    opens.length > 1 ||
    (!!opens[0] &&
      (!opens[0].checked_in_at ||
        opens[0].tanggal < geserTanggal(date, -1) ||
        !Number.isFinite(new Date(opens[0].checked_in_at).getTime()) ||
        new Date(opens[0].checked_in_at).getTime() > new Date(now).getTime()));
  return {
    row,
    correction,
    action: correction
      ? null
      : opens.length
        ? "clockOut"
        : row
          ? null
          : "clockIn",
  } as const;
}
export function waktuSesiWIB(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
}
