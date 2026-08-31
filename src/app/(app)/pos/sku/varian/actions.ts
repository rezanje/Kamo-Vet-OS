"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateVariantMembers, variantMemberPayload } from "@/lib/varian";

const BACK = "/pos/sku/varian";

export async function saveVariantFamily(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "OWNER" && profile?.role !== "ADMIN") redirect(BACK);

  const name = String(formData.get("name") ?? "").trim();
  const categoryId = String(formData.get("category_id") ?? "").trim() || null;
  const ids = formData.getAll("item_id").map(String).map((id) => id.trim()).filter(Boolean);
  const labels = formData.getAll("label").map(String);
  const uniqueIds = [...new Set(ids)];
  const { data: items, error: itemError } = uniqueIds.length
    ? await supabase.from("items").select("id,item_type,is_active").in("id", uniqueIds)
    : { data: [], error: null };
  if (itemError) redirect(`${BACK}?error=${encodeURIComponent(itemError.message)}`);
  const itemMap = new Map((items ?? []).map((item) => [String(item.id), item]));
  const rows = ids.map((itemId, index) => ({
    itemId,
    itemType: String(itemMap.get(itemId)?.item_type ?? ""),
    label: labels[index] ?? "",
  }));
  const validation = validateVariantMembers(rows);
  if (validation) redirect(`${BACK}?error=${encodeURIComponent(validation)}`);
  if (!name) redirect(`${BACK}?error=${encodeURIComponent("Nama Keluarga Varian wajib diisi")}`);

  const rpc = await supabase.rpc("replace_item_variant_family", {
    p_family_id: String(formData.get("family_id") ?? "").trim() || null,
    p_name: name,
    p_category_id: categoryId,
    p_members: variantMemberPayload(rows),
  });
  if (rpc.error) redirect(`${BACK}?error=${encodeURIComponent(rpc.error.message)}`);
  revalidatePath(BACK);
  redirect(`${BACK}?success=${encodeURIComponent("Keluarga Varian tersimpan. Harga dan stok tetap milik tiap SKU.")}`);
}
