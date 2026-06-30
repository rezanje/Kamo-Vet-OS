"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function simpanKaryawan(formData: FormData) {
  const supabase = await createClient();

  const nama = String(formData.get("nama") ?? "").trim();
  const nik = String(formData.get("nik") ?? "").trim() || null;
  const jabatan = String(formData.get("jabatan") ?? "").trim() || null;
  const departemen = String(formData.get("departemen") ?? "").trim() || null;
  const branchId = String(formData.get("branch_id") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  const tglMasuk = String(formData.get("tgl_masuk") ?? "").trim() || null;
  const gajiPokok = Number(formData.get("gaji_pokok")) || 0;
  const status = String(formData.get("status") ?? "Aktif");

  // ponytail: validasi nama wajib diisi sebelum insert.
  if (!nama) {
    redirect(`/hris/karyawan?error=${encodeURIComponent("Nama karyawan wajib diisi")}`);
  }

  const { error } = await supabase.from("employees").insert({
    nik,
    nama,
    jabatan,
    departemen,
    branch_id: branchId,
    phone,
    email,
    tgl_masuk: tglMasuk,
    gaji_pokok: gajiPokok,
    status,
  });

  if (error) {
    const msg =
      error.code === "23505"
        ? "NIK sudah terdaftar, gunakan NIK lain"
        : "Gagal menyimpan data karyawan";
    redirect(`/hris/karyawan?error=${encodeURIComponent(msg)}`);
  }

  redirect("/hris/karyawan?success=1");
}
