// Logika quest staff (Addendum §8) — pure, unit-tested. Currency staff ≠ poin customer.

export type QuestDef = {
  id: string;
  quest_type: "daily" | "monthly";
  target_kind: "product_qty" | "category_qty" | "total_sales_amount";
  target_ref_id: string | null;
  target_value: number;
  points_reward: number;
};

export type SaleLine = { item_id: string | null; category_id: string | null; qty: number };

// WIB (UTC+7) — reset harian mengikuti timezone cabang, default WIB.
export function periodKey(questType: "daily" | "monthly", now: Date): string {
  const wib = new Date(now.getTime() + 7 * 3600 * 1000);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const d = String(wib.getUTCDate()).padStart(2, "0");
  return questType === "daily" ? `${y}-${m}-${d}` : `${y}-${m}`;
}

// Kontribusi satu transaksi paid ke sebuah quest.
// target_ref_id null pada product_qty/category_qty = semua produk dihitung.
export function saleContribution(
  quest: Pick<QuestDef, "target_kind" | "target_ref_id">,
  lines: SaleLine[],
  saleTotal: number,
): number {
  if (quest.target_kind === "total_sales_amount") return saleTotal;
  if (quest.target_kind === "product_qty") {
    return lines
      .filter((l) => !quest.target_ref_id || l.item_id === quest.target_ref_id)
      .reduce((a, l) => a + Number(l.qty), 0);
  }
  // category_qty
  return lines
    .filter((l) => !quest.target_ref_id || l.category_id === quest.target_ref_id)
    .reduce((a, l) => a + Number(l.qty), 0);
}

export function isCompleted(currentValue: number, targetValue: number): boolean {
  return currentValue >= targetValue;
}

// Streak: aktif kemarin → +1; hari bolong → reset 1; hari sama → no-op.
export function applyStreak(
  lastActiveDate: string | null,
  today: string,
  current: number,
  longest: number,
): { current: number; longest: number; changed: boolean } {
  if (lastActiveDate === today) return { current, longest, changed: false };
  const yesterday = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const next = lastActiveDate === yesterday ? current + 1 : 1;
  return { current: next, longest: Math.max(longest, next), changed: true };
}

// Bonus tiap kelipatan N hari (configurable via quest_settings).
export function streakBonusDue(streakDays: number, everyDays: number): boolean {
  return everyDays > 0 && streakDays > 0 && streakDays % everyDays === 0;
}

// Leaderboard bulanan per cabang: sum quest_completion bulan itu — BUKAN running total lifetime.
export function monthlyLeaderboard(
  ledger: { staff_id: string; points_delta: number; source_type: string; created_at: string }[],
  month: string, // 'YYYY-MM'
): { staff_id: string; points: number }[] {
  const sums = new Map<string, number>();
  for (const l of ledger) {
    if (l.source_type !== "quest_completion") continue;
    if (!l.created_at.startsWith(month)) continue;
    sums.set(l.staff_id, (sums.get(l.staff_id) ?? 0) + l.points_delta);
  }
  return [...sums.entries()]
    .map(([staff_id, points]) => ({ staff_id, points }))
    .sort((a, b) => b.points - a.points);
}

export function canRedeem(totalPoints: number, cost: number): boolean {
  return totalPoints >= cost;
}

// countdown "Reset dalam HH:MM:SS" ke tengah malam WIB.
export function msUntilMidnightWib(now: Date): number {
  const wib = new Date(now.getTime() + 7 * 3600 * 1000);
  const nextMidnight = Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate() + 1);
  return nextMidnight - wib.getTime();
}
