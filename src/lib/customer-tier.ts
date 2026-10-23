import type { SupabaseClient } from "@supabase/supabase-js";

export type TierThresholds = { bronze_min: number; silver_min: number; gold_min: number; platinum_min: number };

// Pure: map total transaksi gabungan -> tier. Boundary inklusif (>= threshold).
export function computeTier(combined: number, t: TierThresholds): string {
  if (combined >= t.platinum_min) return "Platinum";
  if (combined >= t.gold_min) return "Gold";
  if (combined >= t.silver_min) return "Silver";
  if (combined >= t.bronze_min) return "Bronze";
  return "New";
}

// Derived global customer statistics must be recomputed behind the source-data
// authorization boundary: session queries may contain only one operational branch.
// Best effort after financial commit; never strand checkout/receipt recovery when
// this secondary update fails. Callers may display a warning on false.
export async function recomputeCustomerTier(supabase: SupabaseClient, customerId: string): Promise<boolean> {
  if (!customerId) return true;
  try {
    const {data,error}=await supabase.rpc("refresh_customer_spending",{p_customer:customerId});
    return !error && data === true;
  } catch {
    return false;
  }
}
