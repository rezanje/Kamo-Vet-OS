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
  const { error } = await supabase
    .from("follow_ups")
    .update({ status, ...(status === "Terkirim" ? { reminded_at: new Date().toISOString() } : null) })
    .eq("id", id);

  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}
