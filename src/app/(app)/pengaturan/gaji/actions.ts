"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";

const BACK = "/pengaturan/gaji";
const gagal = (msg: string): never =>
  redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

export async function simpanAturanGaji(formData: FormData) {
  const supabase = await assertRole(BACK, "aturan gaji", ["OWNER"]);

  const angka = (n: string) => Number(formData.get(n)) || 0;
  const row = {
    telat_mulai_menit: Math.floor(angka("telat_mulai_menit")),
    telat_blok_menit: Math.floor(angka("telat_blok_menit")),
    telat_nominal_per_blok: angka("telat_nominal_per_blok"),
    telat_maks: angka("telat_maks"),
    bolos_per_hari: angka("bolos_per_hari"),
    lembur_per_jam: angka("lembur_per_jam"),
  };

  if (row.telat_blok_menit <= 0) gagal("Blok menit harus lebih dari 0");
  if (row.telat_mulai_menit < 0) gagal("Batas bawah telat tidak boleh negatif");
  if (Object.values(row).some((v) => v < 0))
    gagal("Nominal tidak boleh negatif");
  if (row.telat_maks > 0 && row.telat_maks < row.telat_nominal_per_blok) {
    gagal(
      "Batas atas potongan lebih kecil dari satu blok — potongan jadi tidak masuk akal",
    );
  }

  const { error } = await supabase.rpc("hris_save_payroll_policy", {
    p_group: String(formData.get("group_id") ?? "").trim() || null,
    p_from: String(formData.get("effective_date") ?? "").trim(),
    p_settings: row,
    p_reason: String(formData.get("reason") ?? "").trim(),
  });
  if (error)
    gagal(
      error.message?.startsWith("HRIS:")
        ? error.message.slice(5).trim()
        : "Aturan gagal disimpan",
    );
  revalidatePath(BACK);
  redirect(`${BACK}?success=1`);
}
