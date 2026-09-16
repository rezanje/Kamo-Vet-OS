"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { hariIniWIB } from "@/lib/tanggal";

export async function simpanKaryawan(formData: FormData) {
  const supabase = await assertMasterAdmin("/hris/karyawan", "data karyawan");

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

  const { data: created, error } = await supabase.from("employees").insert({
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
  }).select("id").single();

  if (error) {
    const msg =
      error.code === "23505"
        ? "NIK sudah terdaftar, gunakan NIK lain"
        : "Gagal menyimpan data karyawan";
    redirect(`/hris/karyawan?error=${encodeURIComponent(msg)}`);
  }

  if (branchId && created?.id) {
    const { error: assignmentError } = await supabase.from("employee_branch_assignments").upsert({
      employee_id: created.id,
      branch_id: branchId,
      role: "PRIMARY",
      effective_date: tglMasuk || hariIniWIB(),
    }, { onConflict: "employee_id,branch_id" });
    if (assignmentError) {
      redirect(`/hris/karyawan?error=${encodeURIComponent("Karyawan tersimpan, tetapi penugasan cabang belum tersimpan")}`);
    }
  }

  redirect("/hris/karyawan?success=1");
}

export async function simpanPenugasanCabang(formData: FormData) {
  const supabase = await assertMasterAdmin("/hris/karyawan", "penugasan cabang");
  const employeeId = String(formData.get("employee_id") ?? "").trim();
  const branchId = String(formData.get("branch_id") ?? "").trim();
  const role = String(formData.get("role") ?? "SECONDARY").trim();
  const effectiveDate = String(formData.get("effective_date") ?? "").trim() || hariIniWIB();

  if (!employeeId || !branchId || role !== "SECONDARY") {
    redirect(`/hris/karyawan?error=${encodeURIComponent("Pilih karyawan, cabang, dan jenis penugasan")}`);
  }

  const { data: employee } = await supabase.from("employees").select("branch_id").eq("id", employeeId).single();
  if (!employee || employee.branch_id === branchId) redirect(`/hris/karyawan?error=${encodeURIComponent("Pilih cabang tambahan yang berbeda dari cabang utama")}`);

  const { error } = await supabase.from("employee_branch_assignments").upsert({
    employee_id: employeeId,
    branch_id: branchId,
    role,
    effective_date: effectiveDate,
  }, { onConflict: "employee_id,branch_id" });
  if (error) redirect(`/hris/karyawan?error=${encodeURIComponent("Penugasan cabang belum tersimpan")}`);

  redirect("/hris/karyawan?success=assignment");
}
