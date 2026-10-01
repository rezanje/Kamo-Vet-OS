"use server";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { pesanJadwal } from "@/lib/schedule-request";
const BACK = "/hris/pengajuan/jadwal";
async function keputusan(form: FormData, approve: boolean) {
  const supabase = await assertRole(BACK, "pengajuan jadwal", [
    "OWNER",
    "ADMIN",
  ]);
  const { error } = await supabase.rpc("hris_decide_schedule_change", {
    p_request_id: String(form.get("id") ?? "").trim(),
    p_approve: approve,
    p_reason: String(form.get("reason") ?? "").trim(),
  });
  redirect(
    `${BACK}?${new URLSearchParams(error ? { error: pesanJadwal(error) } : { success: "1" })}`,
  );
}
export async function setujuiPerubahanJadwal(form: FormData) {
  return keputusan(form, true);
}
export async function tolakPerubahanJadwal(form: FormData) {
  return keputusan(form, false);
}
