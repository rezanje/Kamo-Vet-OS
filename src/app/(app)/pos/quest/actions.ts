"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Konfigurasi quest & reward dari dashboard (Addendum §8: wajib configurable, bukan hardcode).
// Semua aksi di sini khusus OWNER/ADMIN (manajer cabang / owner).
async function requireManager() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`/pos/quest?error=${encodeURIComponent("Hanya owner/manajer yang bisa mengubah konfigurasi quest")}`);
  }
  return { supabase, userId: user!.id };
}

export async function createQuestDef(formData: FormData) {
  const { supabase, userId } = await requireManager();
  const title = String(formData.get("title") ?? "").trim();
  const questType = String(formData.get("quest_type") ?? "daily");
  const targetKind = String(formData.get("target_kind") ?? "total_sales_amount");
  const targetRefId = String(formData.get("target_ref_id") ?? "") || null;
  const targetValue = Number(formData.get("target_value")) || 0;
  const pointsReward = Number(formData.get("points_reward")) || 0;
  const branchId = String(formData.get("branch_id") ?? "") || null;

  if (!title || targetValue <= 0 || pointsReward <= 0) {
    redirect(`/pos/quest?error=${encodeURIComponent("Lengkapi judul, target, dan poin reward")}`);
  }

  await supabase.from("staff_quest_definitions").insert({
    title, quest_type: questType, target_kind: targetKind,
    target_ref_id: targetKind === "total_sales_amount" ? null : targetRefId,
    target_value: targetValue, points_reward: pointsReward, branch_id: branchId, created_by: userId,
  });
  revalidatePath("/pos/quest");
  redirect("/pos/quest?success=quest");
}

export async function toggleQuestDef(formData: FormData) {
  const { supabase } = await requireManager();
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "1";
  await supabase.from("staff_quest_definitions").update({ is_active: active }).eq("id", id);
  revalidatePath("/pos/quest");
  redirect("/pos/quest");
}

export async function createReward(formData: FormData) {
  const { supabase } = await requireManager();
  const name = String(formData.get("reward_name") ?? "").trim();
  const type = String(formData.get("reward_type") ?? "discount_voucher");
  const cost = Number(formData.get("points_cost")) || 0;
  if (!name || cost <= 0) redirect(`/pos/quest?error=${encodeURIComponent("Lengkapi nama reward dan poin")}`);

  await supabase.from("staff_reward_catalog").insert({ reward_name: name, reward_type: type, points_cost: cost });
  revalidatePath("/pos/quest");
  redirect("/pos/quest?success=reward");
}

export async function toggleReward(formData: FormData) {
  const { supabase } = await requireManager();
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "1";
  await supabase.from("staff_reward_catalog").update({ is_active: active }).eq("id", id);
  revalidatePath("/pos/quest");
  redirect("/pos/quest");
}

// Penyerahan reward fisik/voucher oleh manajer (pending_fulfillment → fulfilled).
export async function fulfillRedemption(formData: FormData) {
  const { supabase, userId } = await requireManager();
  const id = String(formData.get("id") ?? "");
  await supabase
    .from("staff_reward_redemptions")
    .update({ status: "fulfilled", fulfilled_by: userId, fulfilled_at: new Date().toISOString() })
    .eq("id", id).eq("status", "pending_fulfillment");
  revalidatePath("/pos/quest");
  redirect("/pos/quest?success=fulfill");
}
