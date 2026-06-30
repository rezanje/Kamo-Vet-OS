"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function updateVisitStatus(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  await supabase.from("visits").update({ status }).eq("id", id);
  revalidatePath("/klinik/antrian");
}

// Batal hanya untuk pasien yang belum diperiksa (status Menunggu) — belum ada rekam medis,
// jadi hard delete aman tanpa kehilangan data klinis.
export async function cancelVisit(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id"));
  await supabase.from("visits").delete().eq("id", id).eq("status", "Menunggu");
  revalidatePath("/klinik/antrian");
}
