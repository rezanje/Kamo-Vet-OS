"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Konfigurasi promo dari pusat — khusus OWNER/ADMIN.
async function requireManager() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`/crm/promo?error=${encodeURIComponent("Hanya owner/manajer yang bisa mengatur promo")}`);
  }
  return { supabase };
}

export async function createPromo(formData: FormData) {
  const { supabase } = await requireManager();
  const name = String(formData.get("name") ?? "").trim();
  const promoType = String(formData.get("promo_type") ?? "diskon_produk");
  const suggest = String(formData.get("suggest") ?? "").trim();
  const discountType = String(formData.get("discount_type") ?? "") || null;
  const discountValue = formData.get("discount_value") ? Number(formData.get("discount_value")) : null;
  const minQty = formData.get("min_qty") ? Number(formData.get("min_qty")) : null;
  const minSubtotal = formData.get("min_subtotal") ? Number(formData.get("min_subtotal")) : null;
  const validFrom = String(formData.get("valid_from") ?? "").trim() || null;
  const validUntil = String(formData.get("valid_until") ?? "").trim() || null;
  const branchIds = formData.getAll("branch_ids").map(String).filter(Boolean);

  if (!name || !suggest) redirect(`/crm/promo?error=${encodeURIComponent("Nama & teks saran wajib diisi")}`);

  // rakit rule jsonb dari field opsional.
  const rule: Record<string, unknown> = { suggest };
  if (discountType) rule.discount_type = discountType;
  if (discountValue != null) rule.discount_value = discountValue;
  if (minQty != null) rule.min_qty = minQty;
  if (minSubtotal != null) rule.min_subtotal = minSubtotal;

  await supabase.from("promos").insert({
    name, promo_type: promoType, rule,
    branch_ids: branchIds.length ? branchIds : null, // kosong = semua cabang
    valid_from: validFrom, valid_until: validUntil, is_active: true,
  });
  revalidatePath("/crm/promo");
  redirect("/crm/promo?success=1");
}

export async function togglePromo(formData: FormData) {
  const { supabase } = await requireManager();
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "1";
  await supabase.from("promos").update({ is_active: active }).eq("id", id);
  revalidatePath("/crm/promo");
  redirect("/crm/promo");
}
