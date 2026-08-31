"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { validateAlertSettingInput } from "@/lib/operational-alert-settings";

const BACK = "/pengaturan/alert-operasional";

export async function simpanAlertOperasional(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "alert operasional");
  let setting;
  try {
    setting = validateAlertSettingInput({
      ruleKey: String(formData.get("rule_key") ?? ""),
      branchId: String(formData.get("branch_id") ?? ""),
      threshold: String(formData.get("threshold") ?? ""),
      periodDays: String(formData.get("period_days") ?? ""),
      active: String(formData.get("active") ?? ""),
      severity: String(formData.get("severity") ?? ""),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pengaturan alert belum valid";
    redirect(`${BACK}?error=${encodeURIComponent(message)}`);
  }

  if (setting.branchId) {
    const { data: allowed, error } = await supabase.rpc("user_can_access_branch", {
      p_branch_id: setting.branchId,
    });
    if (error || allowed !== true) {
      redirect(`${BACK}?error=${encodeURIComponent("Cabang tidak bisa diakses")}`);
    }
  }

  const { data: { user } } = await supabase.auth.getUser();
  let existingQuery = supabase
    .from("operational_alert_settings")
    .select("id")
    .eq("rule_key", setting.ruleKey);
  existingQuery = setting.branchId
    ? existingQuery.eq("branch_id", setting.branchId)
    : existingQuery.is("branch_id", null);
  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) redirect(`${BACK}?error=${encodeURIComponent("Pengaturan alert gagal dibaca")}`);

  const values = {
    rule_key: setting.ruleKey,
    branch_id: setting.branchId,
    threshold: setting.threshold,
    period_days: setting.periodDays,
    active: setting.active,
    severity: setting.severity,
    updated_by: user?.id ?? null,
    updated_at: new Date().toISOString(),
  };
  const result = existing?.id
    ? await supabase.from("operational_alert_settings").update(values).eq("id", existing.id)
    : await supabase.from("operational_alert_settings").insert({
      ...values,
      created_by: user?.id ?? null,
    });
  if (result.error) redirect(`${BACK}?error=${encodeURIComponent("Pengaturan alert gagal disimpan")}`);

  revalidatePath(BACK);
  revalidatePath("/laporan/operasional-penjualan");
  redirect(`${BACK}?success=1`);
}
