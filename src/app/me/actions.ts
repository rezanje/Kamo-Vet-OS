"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyEmployee } from "@/lib/employee";

function todayJakarta(): string {
  // WIB (UTC+7) date string YYYY-MM-DD.
  const wib = new Date(new Date().getTime() + 7 * 3600 * 1000);
  return wib.toISOString().slice(0, 10);
}
function nowTimeJakarta(): string {
  const wib = new Date(new Date().getTime() + 7 * 3600 * 1000);
  return wib.toISOString().slice(11, 16); // HH:MM
}

export async function clockIn() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const emp = user ? await getMyEmployee(supabase as never, user.id) : null;
  if (!emp) redirect(`/me?error=${encodeURIComponent("Akun belum tertaut ke data karyawan")}`);

  // upsert: buat / isi jam_masuk untuk hari ini (pola sama dgn hris/absensi).
  await supabase.from("attendance").upsert(
    { employee_id: emp!.id, tanggal: todayJakarta(), jam_masuk: nowTimeJakarta(), status: "Hadir" },
    { onConflict: "employee_id,tanggal" },
  );
  redirect("/me?success=in");
}

export async function clockOut() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const emp = user ? await getMyEmployee(supabase as never, user.id) : null;
  if (!emp) redirect(`/me?error=${encodeURIComponent("Akun belum tertaut ke data karyawan")}`);

  await supabase.from("attendance")
    .update({ jam_pulang: nowTimeJakarta() })
    .eq("employee_id", emp!.id).eq("tanggal", todayJakarta());
  redirect("/me?success=out");
}

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
