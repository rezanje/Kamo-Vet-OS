"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function transferKepemilikan(form: FormData): Promise<{ error?: string; success?: boolean }> {
  const pet = String(form.get("pet_id") ?? "");
  const from = String(form.get("from_customer_id") ?? "");
  const to = String(form.get("to_customer_id") ?? "");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (![pet, from, to].every((id) => uuid.test(id)) || from === to || form.get("confirmed") !== "yes") {
    return { error: "Pilih pemilik tujuan berbeda dan konfirmasi perpindahan." };
  }
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: "Silakan login kembali." };
  const { data: me } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) return { error: "Hanya owner/admin yang boleh memindahkan kepemilikan." };
  const { error } = await db.rpc("transfer_pet_ownership", { p_pet_id: pet, p_from_customer_id: from, p_to_customer_id: to });
  if (error) {
    if (error.code === "23505") return { error: "Pemilik tujuan sudah memiliki anabul dengan nama sama. Periksa kartunya sebelum transfer." };
    if (error.code === "P0001") return { error: error.message };
    return { error: "Perpindahan belum tersimpan. Coba lagi atau hubungi admin." };
  }
  revalidatePath("/crm/pelanggan");
  revalidatePath("/crm/anabul/transfer");
  revalidatePath("/klinik/rekam-medis");
  revalidatePath("/klinik/registrasi");
  return { success: true };
}
