"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Klaim quest yang completed — poin sudah auto-award saat complete; klaim cuma pindah
// status utk momen positive reinforcement (§8).
export async function claimQuest(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const progressId = String(formData.get("progressId") ?? "");
  if (!progressId || !user) redirect("/kasir/quest");

  const { error } = await supabase.rpc("claim_staff_quest", { p_progress_id: progressId });
  if (error) redirect(`/kasir/quest?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/kasir/quest");
  redirect("/kasir/quest?success=klaim");
}

// Tukar reward: validasi saldo di server, deduct via ledger negatif (§8).
export async function redeemReward(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const rewardId = String(formData.get("rewardId") ?? "");
  if (!rewardId || !user) redirect("/kasir/quest");

  const requestKey = String(formData.get("requestKey") ?? "").trim();
  if (!requestKey || requestKey.length > 120) throw new Error("Identitas penukaran belum siap. Muat ulang halaman.");
  const { error } = await supabase.rpc("redeem_staff_reward", { p_reward_id: rewardId, p_request_key: requestKey });
  if (error) throw new Error(error.message);
  revalidatePath("/kasir/quest");
  redirect(`/kasir/quest?success=redeem&draft_scope=${encodeURIComponent(`reward-redeem:${rewardId}`)}&draft_done=${encodeURIComponent(requestKey)}`);
}
