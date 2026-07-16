"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Tandai / lepas flag bahan baku racikan pada satu item.
export async function setBahanBaku(itemId: string, value: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("items")
    .update({ is_compound_material: value })
    .eq("id", itemId);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/klinik/bahan-baku");
  return { ok: true as const };
}
