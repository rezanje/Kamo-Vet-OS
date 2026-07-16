"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Tandai / lepas flag bahan baku racikan pada satu item.
export async function setBahanBaku(itemId: string, value: boolean) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("items")
    .update({ is_compound_material: value })
    .eq("id", itemId)
    .select("id");
  if (error) return { ok: false as const, error: error.message };
  // RLS yang menolak update mengembalikan 0 baris tanpa error — perlakukan sbg gagal
  // supaya UI optimistik tidak menampilkan sukses palsu.
  if (!data || data.length === 0) return { ok: false as const, error: "Tidak berizin mengubah master barang." };
  revalidatePath("/klinik/bahan-baku");
  return { ok: true as const };
}
