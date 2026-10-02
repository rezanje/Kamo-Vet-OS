"use server";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import {
  field,
  pesanPengajuan,
  submitStaffRequest,
} from "@/lib/hris-request-actions";
const BACK = "/hris/cuti";
export async function ajukanCuti(f: FormData) {
  await assertRole(BACK, "pengajuan karyawan", ["OWNER", "ADMIN"]);
  return submitStaffRequest(
    "leave",
    {
      jenis: field(f, "jenis"),
      tanggal_mulai: field(f, "tanggal_mulai"),
      tanggal_selesai: field(f, "tanggal_selesai"),
      alasan: field(f, "alasan"),
    },
    BACK,
    field(f, "employee_id") || null,
  );
}
async function putuskan(f: FormData, approve: boolean) {
  const db = await assertRole(BACK, "pengajuan cuti", ["OWNER", "ADMIN"]);
  const { error } = await db.rpc("hris_decide_staff_request", {
    p_kind: "leave",
    p_id: field(f, "id"),
    p_approve: approve,
    p_reason: field(f, "catatan"),
    p_tenor: 1,
    p_account: null,
  });
  redirect(
    `${BACK}?${new URLSearchParams(error ? { error: pesanPengajuan(error) } : { success: "keputusan" })}`,
  );
}
export async function setujuiCuti(f: FormData) {
  return putuskan(f, true);
}
export async function tolakCuti(f: FormData) {
  return putuskan(f, false);
}
export async function updateLeaveStatus(f: FormData) {
  await assertRole(BACK, "pengajuan cuti", ["OWNER", "ADMIN"]);
  const status = field(f, "status");
  if (!["Disetujui", "Ditolak"].includes(status))
    redirect(`${BACK}?error=Keputusan+tidak+valid`);
  return putuskan(f, status === "Disetujui");
}
