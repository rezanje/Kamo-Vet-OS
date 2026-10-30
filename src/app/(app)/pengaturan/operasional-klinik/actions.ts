"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertMasterAdmin } from "@/lib/master-guard";
import { angkaIsian } from "@/lib/form-angka";

const BACK = "/pengaturan/operasional-klinik";

export async function tambahKapasitasRawatInap(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "kapasitas rawat inap");
  const branchId = String(formData.get("branch_id") ?? "").trim();
  const capacity = Math.floor(Number(formData.get("capacity")));
  const validFrom = String(formData.get("valid_from") ?? "").trim();
  const validUntil = String(formData.get("valid_until") ?? "").trim() || null;
  if (!branchId || !Number.isInteger(capacity) || capacity <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(validFrom)
    || (validUntil != null && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil))
    || (validUntil != null && validUntil < validFrom)) {
    redirect(`${BACK}?error=${encodeURIComponent("Cabang, kapasitas, dan periode belum valid")}`);
  }
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("branch_capacity_periods").insert({
    branch_id: branchId, capacity, valid_from: validFrom, valid_until: validUntil, created_by: user?.id ?? null,
  });
  if (error) redirect(`${BACK}?error=${encodeURIComponent(error.message)}`);
  revalidatePath(BACK);
  redirect(`${BACK}?success=1`);
}

/**
 * Uang muka minimal tagihan klinik (keputusan Andri, 29 Oktober 2026).
 *
 * Satu angka untuk seluruh perusahaan, berlaku ke tagihan BARU — rawat jalan maupun tiap
 * tahap rawat inap. Pelunasan piutang menyusul dan kasir petshop tidak terpengaruh.
 * Yang menegakkan tetap database; di sini hanya nilainya yang disimpan.
 */
export async function simpanUangMukaMinimal(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "uang muka minimal klinik");
  // Kolom kosong tidak boleh diam-diam jadi 0 — itu mematikan aturannya tanpa disadari.
  const persen = angkaIsian(formData, "min_dp_percent");
  if (persen === null || !Number.isFinite(persen) || persen < 0 || persen > 100) {
    redirect(`${BACK}?error=${encodeURIComponent("Uang muka minimal harus angka 0–100 persen.")}`);
  }
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("clinic_billing_settings")
    .upsert({
      id: true, min_dp_percent: persen,
      updated_by: user?.id ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: "id" })
    .select("id");
  if (error) redirect(`${BACK}?error=${encodeURIComponent(error.message)}`);
  // Tabel satu baris: update atas baris yang hilang lolos tanpa error padahal tidak menyimpan apa pun.
  if (!Array.isArray(data) || data.length !== 1) {
    redirect(`${BACK}?error=${encodeURIComponent("Uang muka minimal tidak tersimpan. Muat ulang lalu coba lagi.")}`);
  }
  revalidatePath(BACK);
  redirect(`${BACK}?success=dp&persen=${persen}`);
}
