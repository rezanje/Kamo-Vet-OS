"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const KATEGORI_OPTIONS = ["Umum", "Member", "B2B", "Rescuer"] as const;

// Kategori pelanggan hanya boleh diubah OWNER/ADMIN (pola crm/promo).
export async function updateKategoriPelanggan(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`/crm/pelanggan?error=${encodeURIComponent("Hanya owner/admin yang bisa mengubah kategori")}`);
  }

  const id = String(formData.get("id") ?? "");
  const kategori = String(formData.get("kategori") ?? "");
  if (!id || !KATEGORI_OPTIONS.includes(kategori as (typeof KATEGORI_OPTIONS)[number])) {
    redirect(`/crm/pelanggan?error=${encodeURIComponent("Kategori tidak valid")}`);
  }

  await supabase.from("customers").update({ kategori }).eq("id", id);
  revalidatePath("/crm/pelanggan");
}
