"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RESET_SIMULASI_UNAVAILABLE_MESSAGE } from "@/lib/simulasi-reset";

// Old mounted forms/direct submissions must stay harmless even for OWNER.
// No confirmation, role, or future database grant unlocks this retired action.
export async function resetSimulasiBarangDanStok(formData: FormData) {
  void formData;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const message = error || profile?.role !== "OWNER"
    ? "Panduan maintenance reset hanya tersedia untuk Owner. Hubungi Owner atau pengelola sistem."
    : RESET_SIMULASI_UNAVAILABLE_MESSAGE;
  redirect(`/pos/stok?error=${encodeURIComponent(message)}`);
}
