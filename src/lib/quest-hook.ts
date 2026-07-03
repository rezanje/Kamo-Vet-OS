// Hook progres quest setelah transaksi POS paid (Addendum §8).
// Dipanggil best-effort dari checkout — TIDAK PERNAH boleh mem-block transaksi.

import { applyStreak, isCompleted, periodKey, saleContribution, streakBonusDue, type QuestDef, type SaleLine } from "@/lib/quest-logic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export async function processQuestProgress(supabase: AnyClient, opts: {
  staffId: string;
  branchId: string;
  saleTotal: number;
  lines: { item_id: string | null; qty: number }[];
}): Promise<void> {
  try {
    const { staffId, branchId, saleTotal } = opts;
    const now = new Date();

    // kategori item utk category_qty.
    const itemIds = opts.lines.map((l) => l.item_id).filter(Boolean) as string[];
    const { data: cats } = itemIds.length
      ? await supabase.from("items").select("id, category_id").in("id", itemIds)
      : { data: [] };
    const catMap = new Map((cats ?? []).map((c: { id: string; category_id: string | null }) => [c.id, c.category_id]));
    const lines: SaleLine[] = opts.lines.map((l) => ({
      item_id: l.item_id, qty: l.qty,
      category_id: l.item_id ? ((catMap.get(l.item_id) as string | null) ?? null) : null,
    }));

    // quest aktif: global (branch null) atau cabang transaksi.
    const { data: defs } = await supabase
      .from("staff_quest_definitions")
      .select("id, quest_type, target_kind, target_ref_id, target_value, points_reward, branch_id")
      .eq("is_active", true);
    const active = ((defs ?? []) as (QuestDef & { branch_id: string | null })[])
      .filter((d) => !d.branch_id || d.branch_id === branchId);

    let totalAward = 0;
    for (const q of active) {
      const add = saleContribution(q, lines, saleTotal);
      if (add <= 0) continue;
      const key = periodKey(q.quest_type, now);

      const { data: existing } = await supabase
        .from("staff_quest_progress")
        .select("id, current_value, status")
        .eq("staff_id", staffId).eq("quest_definition_id", q.id).eq("period_key", key)
        .maybeSingle();

      if (!existing) {
        const newVal = add;
        const done = isCompleted(newVal, Number(q.target_value));
        await supabase.from("staff_quest_progress").insert({
          staff_id: staffId, quest_definition_id: q.id, period_key: key, current_value: newVal,
          status: done ? "completed" : "in_progress", completed_at: done ? now.toISOString() : null,
        });
        if (done) {
          totalAward += q.points_reward;
          await supabase.from("staff_points_ledger").insert({
            staff_id: staffId, points_delta: q.points_reward, source_type: "quest_completion",
            source_id: q.id, branch_id: branchId, notes: `Quest selesai (${key})`,
          });
        }
      } else if (existing.status === "in_progress") {
        const newVal = Number(existing.current_value) + add;
        const done = isCompleted(newVal, Number(q.target_value));
        await supabase.from("staff_quest_progress").update({
          current_value: newVal,
          ...(done ? { status: "completed", completed_at: now.toISOString() } : {}),
        }).eq("id", existing.id);
        if (done) {
          // auto-award saat complete; tombol "Klaim" di UI hanya pindah status → claimed (§8).
          totalAward += q.points_reward;
          await supabase.from("staff_points_ledger").insert({
            staff_id: staffId, points_delta: q.points_reward, source_type: "quest_completion",
            source_id: q.id, branch_id: branchId, notes: `Quest selesai (${key})`,
          });
        }
      } else {
        // completed/claimed: tetap update current_value biar progress bar akurat.
        await supabase.from("staff_quest_progress")
          .update({ current_value: Number(existing.current_value) + add })
          .eq("id", existing.id);
      }
    }

    // streak harian: bagian dari transaksi pertama hari itu — bukan cron terpisah (§8).
    const today = periodKey("daily", now);
    const { data: st } = await supabase
      .from("staff_streaks").select("current_streak_days, longest_streak_days, last_active_date")
      .eq("staff_id", staffId).maybeSingle();
    const res = applyStreak(st?.last_active_date ?? null, today, st?.current_streak_days ?? 0, st?.longest_streak_days ?? 0);
    if (res.changed) {
      await supabase.from("staff_streaks").upsert({
        staff_id: staffId, current_streak_days: res.current, longest_streak_days: res.longest,
        last_active_date: today, updated_at: now.toISOString(),
      });
      const { data: cfg } = await supabase.from("quest_settings").select("streak_bonus_every_days, streak_bonus_points").eq("id", 1).maybeSingle();
      if (cfg && streakBonusDue(res.current, cfg.streak_bonus_every_days)) {
        totalAward += cfg.streak_bonus_points;
        await supabase.from("staff_points_ledger").insert({
          staff_id: staffId, points_delta: cfg.streak_bonus_points, source_type: "streak_bonus",
          branch_id: branchId, notes: `Bonus streak ${res.current} hari`,
        });
      }
    }

    if (totalAward > 0) {
      const { data: sp } = await supabase.from("staff_points").select("total_points").eq("staff_id", staffId).maybeSingle();
      await supabase.from("staff_points").upsert({
        staff_id: staffId, total_points: (sp?.total_points ?? 0) + totalAward, updated_at: now.toISOString(),
      });
    }
  } catch (err) {
    // best-effort: gamifikasi tidak boleh mengganggu checkout.
    console.error("[quest] progress error (ignored):", err);
  }
}
