"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertPayrollOwner } from "@/lib/master-guard";

const BACK = "/hris/komponen-gaji";
const gagal = (msg: string): never => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

export async function simpanKomponen(formData: FormData) {
  const supabase = await assertPayrollOwner(BACK);

  const id = String(formData.get("id") ?? "").trim();
  const nama = String(formData.get("nama") ?? "").trim();
  const tipe = String(formData.get("tipe") ?? "").trim();
  const nominalRaw = String(formData.get("nominal") ?? "").trim();
  const nominal = nominalRaw === "" ? 0 : Number(nominalRaw);
  const employeeContext = String(formData.get("emp") ?? "").trim();
  const emp = /^[0-9a-f-]{36}$/i.test(employeeContext) ? employeeContext : "";
  const gagalSimpan = (message: string): never => {
    const query = new URLSearchParams({ error: message, ...(id ? { edit: id } : {}), ...(emp ? { emp } : {}) });
    redirect(`${BACK}?${query}`);
  };

  if (!nama) gagalSimpan("Nama komponen wajib diisi");
  if (tipe !== "tunjangan" && tipe !== "potongan") gagalSimpan("Jenis komponen tidak dikenal");
  if (!Number.isFinite(nominal) || nominal < 0) gagalSimpan("Nominal tidak valid");

  const row = { nama, tipe, nominal };
  const { error } = id
    ? await supabase.from("salary_components").update(row).eq("id", id)
    : await supabase.from("salary_components").insert(row);
  if (error) gagalSimpan(error.message);

  revalidatePath(BACK);
  if (emp) revalidatePath(`/hris/karyawan/${emp}`);
  const query = new URLSearchParams({ success: "1", ...(emp ? { emp } : {}) });
  redirect(`${BACK}?${query}`);
}

export async function toggleKomponen(formData: FormData) {
  const supabase = await assertPayrollOwner(BACK);
  const id = String(formData.get("id") ?? "").trim();
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) gagal("Komponen tidak valid");

  const { error } = await supabase.from("salary_components").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}

// Pasang komponen ke karyawan. Nominal kosong = ikut nominal bawaan komponen,
// supaya naik-turun tunjangan cukup diubah sekali di master.
export async function pasangKomponen(formData: FormData) {
  const supabase = await assertPayrollOwner(BACK);

  const employeeId = String(formData.get("employee_id") ?? "").trim();
  const componentId = String(formData.get("component_id") ?? "").trim();
  const back = formData.get("return_to") === "profil" && /^[0-9a-f-]{36}$/i.test(employeeId) ? `/hris/karyawan/${employeeId}` : BACK;
  const gagalPasang = (msg: string): never => redirect(`${back}?error=${encodeURIComponent(msg)}`);
  const nominalRaw = String(formData.get("nominal") ?? "").trim();
  const nominal = nominalRaw === "" ? null : Number(nominalRaw);

  if (!employeeId) gagalPasang("Pilih karyawan");
  if (!componentId) gagalPasang("Pilih komponen");
  if (nominal !== null && (!Number.isFinite(nominal) || nominal < 0)) gagalPasang("Nominal tidak valid");

  // Index uniknya (employee_id, component_id) penuh — upsert aman di sini.
  const { error } = await supabase
    .from("employee_salary_components")
    .upsert({ employee_id: employeeId, component_id: componentId, nominal }, { onConflict: "employee_id,component_id" });
  if (error) gagalPasang(error.message);

  revalidatePath(back);
  revalidatePath(BACK);
  revalidatePath("/hris/penggajian");
  redirect(`${back}?success=${back === BACK ? "1" : "benefit"}&emp=${employeeId}`);
}

export async function lepasKomponen(formData: FormData) {
  const supabase = await assertPayrollOwner(BACK);
  const id = String(formData.get("id") ?? "").trim();
  const emp = String(formData.get("employee_id") ?? "").trim();
  const back = formData.get("return_to") === "profil" && /^[0-9a-f-]{36}$/i.test(emp) ? `/hris/karyawan/${emp}` : BACK;
  if (!id || !emp) redirect(`${back}?error=Data%20tidak%20valid`);
  const { error } = await supabase.from("employee_salary_components").delete().eq("id", id).eq("employee_id", emp);
  if (error) redirect(`${back}?error=${encodeURIComponent("Komponen gagal dilepas")}`);
  revalidatePath(back);
  revalidatePath(BACK);
  revalidatePath("/hris/penggajian");
  redirect(`${back}?success=${back === BACK ? "1" : "benefit"}&emp=${emp}`);
}
