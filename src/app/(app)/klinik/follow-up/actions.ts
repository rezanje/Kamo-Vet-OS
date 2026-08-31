"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const BACK = "/klinik/follow-up";

// Staff sudah klik tombol WhatsApp / sudah menghubungi → catat supaya gak dobel kirim.
export async function tandaiFollowUp(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["Terkirim", "Selesai", "Batal"].includes(status)) {
    redirect(`${BACK}?error=${encodeURIComponent("Aksi tidak valid")}`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: followUp, error: loadError } = await supabase.from("follow_ups")
    .select("id, status, branch_id, visit_id").eq("id", id).maybeSingle();
  if (loadError || !followUp) redirect(`${BACK}?error=${encodeURIComponent(loadError?.message ?? "Follow up tidak ditemukan")}`);
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("follow_ups")
    .update({
      status,
      ...(status === "Terkirim" ? { reminded_at: now } : {}),
      ...(status === "Selesai" ? { completed_at: now, completed_by: user?.id ?? null } : { completed_at: null, completed_by: null }),
    })
    .eq("id", id)
    .eq("status", followUp.status);

  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}
