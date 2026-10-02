"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { submitStaffRequest, field } from "@/lib/hris-request-actions";
function coordinate(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
async function clock(form: FormData, action: "in" | "out") {
  const supabase = await createClient();
  const { error } = await supabase.rpc("hris_clock_attendance", {
    p_action: action,
    p_branch_id: String(form.get("branch_id") ?? "") || null,
    p_lat: coordinate(form.get("lat")),
    p_lng: coordinate(form.get("lng")),
  });
  if (error) {
    const message =
      error.code === "PGRST202"
        ? "Fitur sesi absensi belum aktif. Hubungi HR."
        : error.message.replace(/^ATTENDANCE:\s*/, "");
    redirect(`/me?error=${encodeURIComponent(message)}`);
  }
  redirect(`/me?success=${action}`);
}
export async function clockIn(formData: FormData) {
  return clock(formData, "in");
}
export async function clockOut(formData: FormData) {
  return clock(formData, "out");
}

export async function ajukanCutiPribadi(form: FormData) {
  return submitStaffRequest("leave", {
    jenis: field(form, "jenis"),
    tanggal_mulai: field(form, "tanggal_mulai"),
    tanggal_selesai: field(form, "tanggal_selesai"),
    alasan: field(form, "alasan"),
  });
}
