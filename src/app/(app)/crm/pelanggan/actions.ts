"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Golongan pelanggan hanya boleh diubah OWNER/ADMIN (pola crm/promo).
export async function updateKategoriPelanggan(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`/crm/pelanggan?error=${encodeURIComponent("Hanya owner/admin yang bisa mengubah golongan")}`);
  }

  const id = String(formData.get("id") ?? "");
  const categoryId = String(formData.get("category_id") ?? "").trim() || null;
  if (!id) redirect(`/crm/pelanggan?error=${encodeURIComponent("Pelanggan tidak valid")}`);

  // Id golongan dari form diverifikasi ada & aktif — jangan percaya kiriman klien.
  if (categoryId) {
    const { data: kat } = await supabase
      .from("customer_categories").select("id").eq("id", categoryId).eq("is_active", true).maybeSingle();
    if (!kat) redirect(`/crm/pelanggan?error=${encodeURIComponent("Golongan tidak valid")}`);
  }

  await supabase.from("customers").update({ category_id: categoryId }).eq("id", id);
  revalidatePath("/crm/pelanggan");
}
