"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function simpanAbsensi(formData: FormData) {
  const supabase = await createClient();

  const employeeId = String(formData.get("employee_id") ?? "").trim();
  const tanggal = String(formData.get("tanggal") ?? "").trim() || "2026-07-01";
  const jamMasuk = String(formData.get("jam_masuk") ?? "").trim() || null;
  const jamPulang = String(formData.get("jam_pulang") ?? "").trim() || null;
  const status = String(formData.get("status") ?? "Hadir");
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;

  // ponytail: validasi employee_id wajib dipilih sebelum upsert.
  if (!employeeId) {
    redirect(`/hris/absensi?error=${encodeURIComponent("Karyawan wajib dipilih")}&tgl=${tanggal}`);
  }

  // ponytail: upsert — on conflict (employee_id, tanggal) do update set semua field.
  // Supabase upsert dengan onConflict mengupdate row yang sudah ada untuk tanggal + karyawan sama.
  const { error } = await supabase.from("attendance").upsert(
    {
      employee_id: employeeId,
      tanggal,
      jam_masuk: jamMasuk,
      jam_pulang: jamPulang,
      status,
      keterangan,
    },
    { onConflict: "employee_id,tanggal" }
  );

  if (error) {
    redirect(`/hris/absensi?error=${encodeURIComponent("Gagal menyimpan absensi: " + error.message)}&tgl=${tanggal}`);
  }

  redirect(`/hris/absensi?success=1&tgl=${tanggal}`);
}
