import { aksesCabangHRIS } from "./jadwal-scope";
import { hariIniWIB } from "./tanggal";
import { akhirBulan } from "./payroll-data";
import { rekapJadwal, type DataRekap } from "./attendance-recap";
import type { createClient } from "./supabase/server";
export async function loadAttendanceRecap(
  db: Awaited<ReturnType<typeof createClient>>,
  sp: { periode?: string; cabang?: string },
) {
  const period = sp.periode ?? hariIniWIB().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))
    throw new Error("Periode tidak valid");
  const access = await aksesCabangHRIS(db);
  if (!["OWNER", "ADMIN"].includes(access.role))
    throw new Error("Rekap hanya untuk HR yang diizinkan");
  const branch =
    sp.cabang ??
    (access.role === "OWNER" ? "" : (access.branches[0]?.id ?? ""));
  if (branch && !access.branches.some((b) => b.id === branch))
    throw new Error("Cabang tidak diizinkan");
  if (!branch && access.role !== "OWNER")
    throw new Error("Pilih cabang yang diizinkan");
  const start = `${period}-01`;
  const end = akhirBulan(period);
  const { data, error } = await db.rpc("hris_attendance_recap", {
    p_start: start,
    p_end: end,
    p_branch_id: branch || null,
  });
  if (error || !data)
    throw new Error(
      error?.message?.startsWith("HRIS:")
        ? error.message.replace(/^HRIS:\s*/, "")
        : "Rekap gagal dimuat. Periksa akses cabang dan aktivasi fitur.",
    );
  return {
    period,
    branch,
    access,
    data: data as DataRekap,
    result: rekapJadwal(data as DataRekap, hariIniWIB()),
  };
}
