"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/master-guard";
import { jalankanWaEngine } from "@/lib/wa-engine";

const BACK = "/pengaturan/wa-engine";
const KEYS = [
  "post_grooming_enabled", "post_treatment_enabled", "vaccination_due_enabled",
  "vaccination_overdue_enabled", "lapsed_enabled", "owner_birthday_enabled", "pet_birthday_enabled",
] as const;

export async function simpanWaSettings(formData: FormData) {
  const supabase = await assertRole(BACK, "pengaturan WA", ["OWNER", "ADMIN"]);
  const payload: Record<string, boolean | string> = {
    is_enabled: formData.get("is_enabled") === "on",
    updated_at: new Date().toISOString(),
  };
  for (const key of KEYS) payload[key] = formData.get(key) === "on";
  const { error } = await supabase.from("wa_engine_settings").upsert({ id: true, ...payload }, { onConflict: "id" });
  if (error) redirect(`${BACK}?error=${encodeURIComponent("Pengaturan WA belum tersimpan")}`);
  revalidatePath(BACK);
  redirect(`${BACK}?success=settings`);
}

export async function jalankanWaManual() {
  const supabase = await assertRole(BACK, "pengiriman WA", ["OWNER", "ADMIN"]);
  const hasil = await jalankanWaEngine(supabase);
  revalidatePath(BACK);
  redirect(`${BACK}?success=run&sent=${hasil.sent}&failed=${hasil.failed}&created=${hasil.created}`);
}
