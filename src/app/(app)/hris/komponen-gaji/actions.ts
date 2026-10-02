"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertMasterAdmin, assertRole } from "@/lib/master-guard";
import { field, pesanPengajuan } from "@/lib/hris-request-actions";
import { hariIniWIB } from "@/lib/tanggal";
const BACK = "/hris/komponen-gaji";
const month = (f: FormData) =>
  field(f, "effective_period") || hariIniWIB().slice(0, 7);
const backFor = (f: FormData, emp: string) =>
  field(f, "return_to") === "profil" && /^[0-9a-f-]{36}$/i.test(emp)
    ? `/hris/karyawan/${emp}`
    : BACK;
const fail = (back: string, msg: string): never =>
  redirect(`${back}?error=${encodeURIComponent(msg)}`);
export async function simpanKomponen(f: FormData) {
  const db = await assertRole(BACK, "master komponen gaji", ["OWNER"]);
  const { error } = await db.rpc("hris_save_salary_component", {
    p_component: field(f, "id") || null,
    p_month: month(f),
    p_name: field(f, "nama"),
    p_type: field(f, "tipe"),
    p_amount: Number(field(f, "nominal") || 0),
    p_active: true,
    p_reason: field(f, "reason"),
  });
  if (error) fail(BACK, pesanPengajuan(error));
  redirect(`${BACK}?success=1`);
}
export async function toggleKomponen(f: FormData) {
  const db = await assertRole(BACK, "master komponen gaji", ["OWNER"]),
    id = field(f, "id");
  const { data: old, error: loadError } = await db
    .from("salary_components")
    .select("nama,tipe,nominal")
    .eq("id", id)
    .maybeSingle();
  if (loadError || !old) fail(BACK, "Komponen tidak ditemukan");
  const { error } = await db.rpc("hris_save_salary_component", {
    p_component: id,
    p_month: month(f),
    p_name: old!.nama,
    p_type: old!.tipe,
    p_amount: Number(old!.nominal),
    p_active: field(f, "aktif") !== "1",
    p_reason: field(f, "reason"),
  });
  if (error) fail(BACK, pesanPengajuan(error));
  redirect(`${BACK}?success=1`);
}
export async function pasangKomponen(f: FormData) {
  const db = await assertMasterAdmin(BACK, "komponen gaji karyawan"),
    emp = field(f, "employee_id"),
    back = backFor(f, emp),
    raw = field(f, "nominal");
  const { error } = await db.rpc("hris_set_employee_component", {
    p_employee: emp,
    p_component: field(f, "component_id"),
    p_month: month(f),
    p_amount: raw === "" ? null : Number(raw),
    p_active: true,
    p_reason: field(f, "reason"),
  });
  if (error) fail(back, pesanPengajuan(error));
  revalidatePath(back);
  revalidatePath(BACK);
  revalidatePath("/hris/penggajian");
  redirect(`${back}?success=${back === BACK ? "1" : "benefit"}&emp=${emp}`);
}
export async function lepasKomponen(f: FormData) {
  const db = await assertMasterAdmin(BACK, "komponen gaji karyawan"),
    emp = field(f, "employee_id"),
    back = backFor(f, emp),
    id = field(f, "id");
  const { data: old, error: loadError } = await db
    .from("employee_salary_components")
    .select("component_id,nominal")
    .eq("id", id)
    .eq("employee_id", emp)
    .maybeSingle();
  if (loadError || !old)
    fail(back, "Komponen tidak ditemukan atau karyawan tidak diizinkan");
  const { error } = await db.rpc("hris_set_employee_component", {
    p_employee: emp,
    p_component: old!.component_id,
    p_month: month(f),
    p_amount: old!.nominal,
    p_active: false,
    p_reason: field(f, "reason"),
  });
  if (error) fail(back, pesanPengajuan(error));
  revalidatePath(back);
  revalidatePath(BACK);
  revalidatePath("/hris/penggajian");
  redirect(`${back}?success=${back === BACK ? "1" : "benefit"}&emp=${emp}`);
}
