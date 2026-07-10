export type TierThresholds = { bronze_min: number; silver_min: number; gold_min: number; platinum_min: number };

// Pure: map total transaksi gabungan -> tier. Boundary inklusif (>= threshold).
export function computeTier(combined: number, t: TierThresholds): string {
  if (combined >= t.platinum_min) return "Platinum";
  if (combined >= t.gold_min) return "Gold";
  if (combined >= t.silver_min) return "Silver";
  if (combined >= t.bronze_min) return "Bronze";
  return "New";
}
