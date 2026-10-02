"use server";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { field, pesanPengajuan } from "@/lib/hris-request-actions";
const BACK = "/hris/pengajuan";
async function putuskan(kind: string, approve: boolean, f: FormData) {
  const db = await assertRole(BACK, "pengajuan karyawan", ["OWNER", "ADMIN"]);
  const { error } = await db.rpc("hris_decide_staff_request", {
    p_kind: kind,
    p_id: field(f, "id"),
    p_approve: approve,
    p_reason: field(f, "catatan"),
    p_tenor: Number(field(f, "tenor_bulan") || 1),
    p_account: field(f, "account_id") || null,
  });
  redirect(
    `${BACK}?${new URLSearchParams(error ? { error: pesanPengajuan(error) } : { success: kind })}`,
  );
}
export async function setujuiLembur(f: FormData) {
  return putuskan("overtime", true, f);
}
export async function tolakLembur(f: FormData) {
  return putuskan("overtime", false, f);
}
export async function setujuiReimburse(f: FormData) {
  return putuskan("reimburse", true, f);
}
export async function tolakReimburse(f: FormData) {
  return putuskan("reimburse", false, f);
}
export async function tolakKasbon(f: FormData) {
  return putuskan("cash", false, f);
}
export async function setujuiKasbon(f: FormData) {
  return putuskan("cash", true, f);
}
