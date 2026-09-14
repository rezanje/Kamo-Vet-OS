// Perawatan loyalty otomatis. Dipakai proses akhir bulan dan tombol OWNER.

import { bolehTurunTier, poinKedaluwarsa, tierSebelumnya } from "./loyalty";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

type MaintenanceResult = { expiredCustomers: number; expiredPoints: number; downgradedCustomers: number };

function mundurBulan(now: Date, bulan: number): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - Math.max(1, Math.floor(bulan)));
  return d;
}

function hariAntara(dari: string, sampai: string): number {
  const a = new Date(`${dari}T00:00:00Z`).getTime();
  const b = new Date(`${sampai}T00:00:00Z`).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 864e5)) : 0;
}

export async function jalankanPerawatanLoyalty(
  supabase: AnyClient,
  now = new Date(),
): Promise<MaintenanceResult> {
  const { data: cfg } = await supabase.from("tier_settings")
    .select("points_expiry_enabled, points_expiry_months, tier_downgrade_enabled, tier_downgrade_days")
    .eq("id", 1).maybeSingle();
  const hasil: MaintenanceResult = { expiredCustomers: 0, expiredPoints: 0, downgradedCustomers: 0 };
  const hariIni = new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

  if (cfg?.points_expiry_enabled) {
    const { data: customers } = await supabase.from("customers").select("id, points").gt("points", 0);
    const cutoff = mundurBulan(now, Number(cfg.points_expiry_months) || 12);
    const ref = `EXPIRE-${hariIni}`;

    for (const customer of (customers ?? []) as { id: string; points: number }[]) {
      const { data: ledger } = await supabase.from("point_ledger")
        .select("delta, created_at, expires_at, ref")
        .eq("customer_id", customer.id);
      const rows = (ledger ?? []) as { delta: number; created_at: string; expires_at: string | null; ref: string | null }[];
      const oldEarned = rows
        .filter((r) => Number(r.delta) > 0)
        .filter((r) => r.expires_at
          ? new Date(r.expires_at).getTime() <= now.getTime()
          : new Date(r.created_at).getTime() <= cutoff.getTime())
        .reduce((sum, r) => sum + Math.floor(Number(r.delta) || 0), 0);
      const negatives = rows.filter((r) => Number(r.delta) < 0).map((r) => Number(r.delta));
      const amount = poinKedaluwarsa(oldEarned, negatives, Number(customer.points));
      if (amount <= 0) continue;

      const saldo = Math.max(0, Math.floor(Number(customer.points) || 0) - amount);
      const { error } = await supabase.from("point_ledger").insert({
        customer_id: customer.id,
        delta: -amount,
        saldo,
        ref,
        entry_type: "expiry",
        description: `Poin kedaluwarsa sampai ${hariIni}`,
      });
      if (error) continue;
      await supabase.from("customers").update({ points: saldo }).eq("id", customer.id);
      hasil.expiredCustomers++;
      hasil.expiredPoints += amount;
    }
  }

  if (cfg?.tier_downgrade_enabled) {
    const { data: customers } = await supabase.from("customers")
      .select("id, tier, tier_downgraded_at").neq("tier", "New");
    const ids = ((customers ?? []) as { id: string; tier: string; tier_downgraded_at: string | null }[]).map((c) => c.id);
    if (ids.length) {
      const [{ data: sales }, { data: invoices }] = await Promise.all([
        supabase.from("sales").select("customer_id, created_at").in("customer_id", ids),
        supabase.from("invoices").select("created_at, visits!inner(customer_id)").in("visits.customer_id", ids).is("voided_at", null),
      ]);
      const lastByCustomer = new Map<string, string>();
      for (const row of (sales ?? []) as { customer_id: string; created_at: string }[]) {
        if (!lastByCustomer.get(row.customer_id) || row.created_at > lastByCustomer.get(row.customer_id)!) lastByCustomer.set(row.customer_id, row.created_at);
      }
      for (const row of (invoices ?? []) as { created_at: string; visits: { customer_id: string } | { customer_id: string }[] | null }[]) {
        const visit = Array.isArray(row.visits) ? row.visits[0] : row.visits;
        if (visit && (!lastByCustomer.get(visit.customer_id) || row.created_at > lastByCustomer.get(visit.customer_id)!)) lastByCustomer.set(visit.customer_id, row.created_at);
      }
      for (const customer of (customers ?? []) as { id: string; tier: string; tier_downgraded_at: string | null }[]) {
        const last = lastByCustomer.get(customer.id);
        if (!last) continue;
        const inactiveDays = hariAntara(last.slice(0, 10), hariIni);
        if (!bolehTurunTier({
          enabled: true,
          tier: customer.tier,
          hariTidakTransaksi: inactiveDays,
          ambangHari: Number(cfg.tier_downgrade_days) || 180,
          terakhirTurun: customer.tier_downgraded_at,
          hariIni,
        })) continue;
        await supabase.from("customers").update({ tier: tierSebelumnya(customer.tier), tier_downgraded_at: hariIni }).eq("id", customer.id);
        hasil.downgradedCustomers++;
      }
    }
  }

  return hasil;
}
