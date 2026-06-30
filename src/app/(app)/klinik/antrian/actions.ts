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
