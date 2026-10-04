"use server";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { pesanJadwal } from "@/lib/schedule-request";
const BACK = "/hris/pengajuan/tukar";
async function putuskan(f: FormData, approve: boolean) {
  const db = await assertRole(BACK, "tukar shift", ["OWNER", "ADMIN"]);
  const { error } = await db.rpc("hris_decide_schedule_swap", {
    p_id: String(f.get("id") ?? "").trim(),
    p_approve: approve,
    p_reason: String(f.get("reason") ?? "").trim(),
  });
  redirect(
    `${BACK}?${new URLSearchParams(error ? { error: pesanJadwal(error) } : { success: "1" })}`,
  );
}
export async function setujuiTukarShift(f: FormData) {
  return putuskan(f, true);
}
export async function tolakTukarShiftHR(f: FormData) {
  return putuskan(f, false);
}
