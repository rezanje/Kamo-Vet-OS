"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canRedeem } from "@/lib/quest-logic";

// Klaim quest yang completed — poin sudah auto-award saat complete; klaim cuma pindah
// status utk momen positive reinforcement (§8).
export async function claimQuest(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const progressId = String(formData.get("progressId") ?? "");
  if (!progressId || !user) redirect("/kasir/quest");

  await supabase
    .from("staff_quest_progress")
    .update({ status: "claimed", claimed_at: new Date().toISOString() })
    .eq("id", progressId).eq("staff_id", user.id).eq("status", "completed");

  revalidatePath("/kasir/quest");
  redirect("/kasir/quest?success=klaim");
}

// Tukar reward: validasi saldo di server, deduct via ledger negatif (§8).
export async function redeemReward(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const rewardId = String(formData.get("rewardId") ?? "");
  if (!rewardId || !user) redirect("/kasir/quest");

  const [{ data: reward }, { data: sp }] = await Promise.all([
    supabase.from("staff_reward_catalog").select("id, reward_name, points_cost, is_active").eq("id", rewardId).maybeSingle(),
    supabase.from("staff_points").select("total_points").eq("staff_id", user.id).maybeSingle(),
  ]);
  if (!reward || !reward.is_active) redirect(`/kasir/quest?error=${encodeURIComponent("Reward tidak tersedia")}`);
  const balance = sp?.total_points ?? 0;
  if (!canRedeem(balance, reward!.points_cost)) {
    redirect(`/kasir/quest?error=${encodeURIComponent("Poin belum cukup untuk reward ini")}`);
  }

  const { data: redemption, error } = await supabase
    .from("staff_reward_redemptions")
    .insert({ staff_id: user.id, reward_catalog_id: reward!.id, points_spent: reward!.points_cost })
    .select("id").single();
  if (error || !redemption) redirect(`/kasir/quest?error=${encodeURIComponent(error?.message ?? "Gagal redeem")}`);

  await supabase.from("staff_points_ledger").insert({
    staff_id: user.id, points_delta: -reward!.points_cost, source_type: "reward_redemption",
    source_id: redemption!.id, notes: `Tukar: ${reward!.reward_name}`,
  });
  await supabase.from("staff_points").upsert({
    staff_id: user.id, total_points: balance - reward!.points_cost, updated_at: new Date().toISOString(),
  });

  revalidatePath("/kasir/quest");
  redirect("/kasir/quest?success=redeem");
}
