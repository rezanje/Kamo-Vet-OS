"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// ponytail: insert pengajuan cuti/lembur dengan status default Menunggu.
export async function ajukanCuti(formData: FormData) {
  const supabase = await createClient();

  const employeeId = String(formData.get("employee_id") ?? "").trim();
  const jenis = String(formData.get("jenis") ?? "").trim();
  const tanggalMulai = String(formData.get("tanggal_mulai") ?? "").trim();
  const tanggalSelesai = String(formData.get("tanggal_selesai") ?? "").trim() || null;
  const durasi = formData.get("durasi") ? Number(formData.get("durasi")) : null;
  const alasan = String(formData.get("alasan") ?? "").trim() || null;

  // ponytail: validasi field wajib sebelum insert.
  if (!employeeId) {
    redirect(`/hris/cuti?error=${encodeURIComponent("Karyawan wajib dipilih")}`);
  }
  if (!jenis) {
    redirect(`/hris/cuti?error=${encodeURIComponent("Jenis pengajuan wajib dipilih")}`);
  }
  if (!tanggalMulai) {
    redirect(`/hris/cuti?error=${encodeURIComponent("Tanggal mulai wajib diisi")}`);
  }

  const { error } = await supabase.from("leave_requests").insert({
    employee_id: employeeId,
    jenis,
    tanggal_mulai: tanggalMulai,
    tanggal_selesai: tanggalSelesai,
    durasi: durasi,
    alasan,
    status: "Menunggu",
  });

  if (error) {
    redirect(`/hris/cuti?error=${encodeURIComponent("Gagal menyimpan pengajuan")}`);
  }

  redirect("/hris/cuti?success=1");
}

// ponytail: approve atau tolak pengajuan — sama polanya seperti updateVisitStatus di antrian.
export async function updateLeaveStatus(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  await supabase.from("leave_requests").update({ status }).eq("id", id);
  revalidatePath("/hris/cuti");
}
