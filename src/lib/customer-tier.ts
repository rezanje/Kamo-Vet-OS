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

// Hitung ulang total_spending (petshop sales + klinik invoices LUNAS) lalu set tier.
// Dipanggil server-side setelah tiap transaksi selesai / void. Absolut (bukan incremental)
// biar gak drift — sumber kebenaran selalu tabel sales + invoices.
export async function recomputeCustomerTier(supabase: SupabaseClient, customerId: string): Promise<void> {
  if (!customerId) return;

  const [{ data: sales }, { data: invs }, { data: cfg }] = await Promise.all([
    supabase.from("sales").select("total").eq("customer_id", customerId),
    supabase
      .from("invoices")
      .select("total, visits!inner(customer_id)")
      .eq("visits.customer_id", customerId)
      .eq("paid_status", "Lunas")
      .is("voided_at", null),
    supabase.from("tier_settings").select("bronze_min, silver_min, gold_min, platinum_min").eq("id", 1).maybeSingle(),
  ]);

  const petshop = (sales ?? []).reduce((a, s) => a + Number(s.total || 0), 0);
  const klinik = (invs ?? []).reduce((a, i) => a + Number(i.total || 0), 0);
  const combined = petshop + klinik;

  const thresholds: TierThresholds = cfg
    ? { bronze_min: Number(cfg.bronze_min), silver_min: Number(cfg.silver_min), gold_min: Number(cfg.gold_min), platinum_min: Number(cfg.platinum_min) }
    : { bronze_min: 1_000_000, silver_min: 5_000_000, gold_min: 15_000_000, platinum_min: 50_000_000 };

  await supabase.from("customers").update({ total_spending: combined, tier: computeTier(combined, thresholds) }).eq("id", customerId);
}
