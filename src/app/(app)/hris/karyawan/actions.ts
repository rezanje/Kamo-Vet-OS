"use server";

import { revalidatePath } from "next/cache";
import { parseEmployeeBranches } from "@/lib/employee-branch-input";
import { hariIniWIB } from "@/lib/tanggal";
import { bacaEditKaryawan } from "@/lib/karyawan-edit";
import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { employeeOccupationInput } from "@/lib/employee-occupation";

export async function simpanKaryawan(formData: FormData) {
  const supabase = await assertMasterAdmin("/hris/karyawan", "data karyawan");

  const nama = String(formData.get("nama") ?? "").trim();
  const nik = String(formData.get("nik") ?? "").trim() || null;
  let jabatan: string | null;
  try { jabatan = employeeOccupationInput(formData); }
  catch (error) { redirect(`/hris/karyawan?error=${encodeURIComponent(error instanceof Error ? error.message : "Jabatan tidak valid")}`); }
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
      effective_date: tglMasuk || new Date().toISOString().slice(0, 10),
    }, { onConflict: "employee_id,branch_id" });
    if (assignmentError) {
      redirect(`/hris/karyawan?error=${encodeURIComponent("Karyawan tersimpan, tetapi penugasan cabang belum tersimpan")}`);
    }
  }

  redirect("/hris/karyawan?success=1");
}

export async function simpanPenugasanCabang(formData: FormData) {
  const supabase = await assertMasterAdmin("/hris/karyawan", "penugasan cabang");
  let input;
  try { input = parseEmployeeBranches(formData, hariIniWIB()); }
  catch (error) {
    redirect(`/hris/karyawan?error=${encodeURIComponent(error instanceof Error ? error.message : "Penugasan tidak valid")}`);
  }
  const { error } = await supabase.rpc("assign_employee_secondary_branches", {
    p_employee_id: input.employeeId,
    p_branch_ids: input.branchIds,
    p_effective_date: input.effectiveDate,
  });
  if (error) redirect(`/hris/karyawan?error=${encodeURIComponent("Penugasan belum tersimpan. Pastikan karyawan dan seluruh cabang aktif, dapat diakses, dan berbeda dari cabang utama.")}`);
  revalidatePath("/hris/karyawan");
  revalidatePath(`/hris/karyawan/${input.employeeId}`);

  redirect("/hris/karyawan?success=assignment");
}

export async function editKaryawan(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/hris/karyawan?error=Karyawan%20tidak%20valid");
  const back = `/hris/karyawan/${id}`;
  const supabase = await assertMasterAdmin(back, "data karyawan");
  let row;
  try { row = bacaEditKaryawan(formData); }
  catch (error) { redirect(`${back}?edit=1&error=${encodeURIComponent(error instanceof Error ? error.message : "Data tidak valid")}`); }
  const { data, error } = await supabase.from("employees").update(row).eq("id", id).select("id").maybeSingle();
  if (error || !data) redirect(`${back}?edit=1&error=${encodeURIComponent(error?.code === "23505" ? "NIK sudah terdaftar" : "Data karyawan gagal diperbarui")}`);
  revalidatePath("/hris/karyawan");
  revalidatePath(back);
  revalidatePath("/hris/penggajian");
  redirect(`${back}?success=1`);
}
