"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertMasterAdmin } from "@/lib/master-guard";

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
