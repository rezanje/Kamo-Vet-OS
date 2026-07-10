"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function updateTierSettings(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`/pengaturan/tier?error=${encodeURIComponent("Hanya owner/admin")}`);
  }

  const num = (k: string) => Math.max(0, Number(formData.get(k)) || 0);
  const bronze_min = num("bronze_min"), silver_min = num("silver_min"), gold_min = num("gold_min"), platinum_min = num("platinum_min");
  if (!(bronze_min < silver_min && silver_min < gold_min && gold_min < platinum_min)) {
    redirect(`/pengaturan/tier?error=${encodeURIComponent("Threshold harus naik: Bronze < Silver < Gold < Platinum")}`);
  }

  await supabase.from("tier_settings").update({ bronze_min, silver_min, gold_min, platinum_min }).eq("id", 1);
  revalidatePath("/pengaturan/tier");
  redirect("/pengaturan/tier?success=1");
}
