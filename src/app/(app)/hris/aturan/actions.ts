"use server";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { field, pesanPengajuan } from "@/lib/hris-request-actions";
const BACK = "/hris/aturan";
async function run(name: string, args: Record<string, unknown>, owner = false) {
  const db = await assertRole(
    BACK,
    "aturan bertanggal",
    owner ? ["OWNER"] : ["OWNER", "ADMIN"],
  );
  const { error } = await db.rpc(name, args);
  redirect(
    `${BACK}?${new URLSearchParams(error ? { error: pesanPengajuan(error) } : { success: "1" })}`,
  );
}
export async function buatKelompok(f: FormData) {
  return run(
    "hris_create_pay_group",
    { p_name: field(f, "nama"), p_reason: field(f, "reason") },
    true,
  );
}
export async function simpanAturanKelompok(f: FormData) {
  const keys = [
    "telat_mulai_menit",
    "telat_blok_menit",
    "telat_nominal_per_blok",
    "telat_maks",
    "bolos_per_hari",
    "lembur_per_jam",
  ];
  return run(
    "hris_save_payroll_policy",
    {
      p_group: field(f, "group_id") || null,
      p_from: field(f, "effective_date"),
      p_settings: Object.fromEntries(keys.map((k) => [k, Number(field(f, k))])),
      p_reason: field(f, "reason"),
    },
    true,
  );
}
export async function tambahAnggota(f: FormData) {
  return run("hris_add_pay_group_member", {
    p_employee: field(f, "employee_id"),
    p_group: field(f, "group_id"),
    p_from: field(f, "valid_from"),
    p_to: field(f, "valid_to") || null,
    p_reason: field(f, "reason"),
  });
}
export async function akhiriAnggota(f: FormData) {
  return run("hris_end_pay_group_member", {
    p_id: field(f, "id"),
    p_to: field(f, "valid_to"),
    p_reason: field(f, "reason"),
  });
}
export async function simpanKomponenPeriode(f: FormData) {
  return run("hris_save_period_component", {
    p_employee: field(f, "employee_id"),
    p_month: field(f, "periode"),
    p_name: field(f, "nama"),
    p_type: field(f, "tipe"),
    p_amount: Number(field(f, "nominal")),
    p_reason: field(f, "reason"),
  });
}
export async function hapusKomponenPeriode(f: FormData) {
  return run("hris_remove_period_component", {
    p_id: field(f, "id"),
    p_reason: field(f, "reason"),
  });
}
