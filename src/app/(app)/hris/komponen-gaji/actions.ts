"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";

const BACK = "/hris/komponen-gaji";
const gagal = (msg: string): never => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

export async function simpanKomponen(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "komponen gaji");

  const id = String(formData.get("id") ?? "").trim();
  const nama = String(formData.get("nama") ?? "").trim();
  const tipe = String(formData.get("tipe") ?? "").trim();
  const nominal = Number(formData.get("nominal")) || 0;

  if (!nama) gagal("Nama komponen wajib diisi");
  if (tipe !== "tunjangan" && tipe !== "potongan") gagal("Jenis komponen tidak dikenal");
  if (nominal < 0) gagal("Nominal tidak boleh negatif");

  const row = { nama, tipe, nominal };
  const { error } = id
    ? await supabase.from("salary_components").update(row).eq("id", id)
    : await supabase.from("salary_components").insert(row);
  if (error) gagal(error.message);

  redirect(`${BACK}?success=1`);
}

export async function toggleKomponen(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "komponen gaji");
  const id = String(formData.get("id") ?? "").trim();
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) gagal("Komponen tidak valid");

  const { error } = await supabase.from("salary_components").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}

// Pasang komponen ke karyawan. Nominal kosong = ikut nominal bawaan komponen,
// supaya naik-turun tunjangan cukup diubah sekali di master.
export async function pasangKomponen(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "komponen gaji karyawan");

  const employeeId = String(formData.get("employee_id") ?? "").trim();
  const componentId = String(formData.get("component_id") ?? "").trim();
  const nominalRaw = String(formData.get("nominal") ?? "").trim();
  const nominal = nominalRaw === "" ? null : Number(nominalRaw);

  if (!employeeId) gagal("Pilih karyawan");
  if (!componentId) gagal("Pilih komponen");
  if (nominal !== null && (!Number.isFinite(nominal) || nominal < 0)) gagal("Nominal tidak valid");

  // Index uniknya (employee_id, component_id) penuh — upsert aman di sini.
  const { error } = await supabase
    .from("employee_salary_components")
    .upsert({ employee_id: employeeId, component_id: componentId, nominal }, { onConflict: "employee_id,component_id" });
  if (error) gagal(error.message);

  redirect(`${BACK}?success=1&emp=${employeeId}`);
}

export async function lepasKomponen(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "komponen gaji karyawan");
  const id = String(formData.get("id") ?? "").trim();
  const emp = String(formData.get("employee_id") ?? "").trim();
  if (!id) gagal("Data tidak valid");

  await supabase.from("employee_salary_components").delete().eq("id", id);
  redirect(`${BACK}?success=1${emp ? `&emp=${emp}` : ""}`);
}
