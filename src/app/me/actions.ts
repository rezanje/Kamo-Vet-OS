"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyEmployee } from "@/lib/employee";
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
    p_lat: coordinate(form.get("lat")), p_lng: coordinate(form.get("lng")),
  });
  if (error) {
    const message = error.code === "PGRST202" ? "Fitur sesi absensi belum aktif. Hubungi HR." : error.message.replace(/^ATTENDANCE:\s*/, "");
    redirect(`/me?error=${encodeURIComponent(message)}`);
  }
  redirect(`/me?success=${action}`);
}
export async function clockIn(formData: FormData) { return clock(formData, "in"); }
export async function clockOut(formData: FormData) { return clock(formData, "out"); }

export async function ajukanCutiPribadi(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const emp = user ? await getMyEmployee(supabase as never, user.id) : null;
  if (!emp) redirect(`/me?error=${encodeURIComponent("Akun belum tertaut ke data karyawan")}`);

  const jenis = String(formData.get("jenis") ?? "").trim();
  const tanggalMulai = String(formData.get("tanggal_mulai") ?? "").trim();
  const tanggalSelesai = String(formData.get("tanggal_selesai") ?? "").trim() || null;
  const durasi = formData.get("durasi") ? Number(formData.get("durasi")) : null;
  const alasan = String(formData.get("alasan") ?? "").trim() || null;
  if (!jenis || !tanggalMulai) redirect(`/me?error=${encodeURIComponent("Jenis & tanggal mulai wajib diisi")}`);

  const { error } = await supabase.from("leave_requests").insert({
    employee_id: emp!.id, jenis, tanggal_mulai: tanggalMulai, tanggal_selesai: tanggalSelesai,
    durasi, alasan, status: "Menunggu",
  });
  if (error) redirect(`/me?error=${encodeURIComponent("Gagal simpan pengajuan")}`);
  redirect("/me?success=cuti");
}
