// Aturan loyalty yang tidak bergantung database.

export type LoyaltyTier = "New" | "Bronze" | "Silver" | "Gold" | "Platinum";

const ORDER: LoyaltyTier[] = ["New", "Bronze", "Silver", "Gold", "Platinum"];

export function tierSebelumnya(tier: string): LoyaltyTier {
  const i = ORDER.indexOf(tier as LoyaltyTier);
  return i > 0 ? ORDER[i - 1] : "New";
}

/** Poin lama yang masih bisa dihanguskan setelah pemakaian poin. */
export function poinKedaluwarsa(
  poinDidapatLama: number,
  perubahanNegatif: number[],
  saldoSekarang: number,
): number {
  const earned = Math.max(0, Math.floor(Number(poinDidapatLama) || 0));
  const spent = perubahanNegatif.reduce((sum, delta) => sum + Math.min(0, Math.floor(Number(delta) || 0)), 0);
  return Math.max(0, Math.min(Math.floor(Number(saldoSekarang) || 0), earned + spent));
}

export function bolehTurunTier(o: {
  enabled: boolean;
  tier: string;
  hariTidakTransaksi: number;
  ambangHari: number;
  terakhirTurun?: string | null;
  hariIni: string;
}): boolean {
  if (!o.enabled || o.tier === "New") return false;
  if (o.hariTidakTransaksi < Math.max(1, Math.floor(o.ambangHari))) return false;
  if (!o.terakhirTurun) return true;
  const last = new Date(`${o.terakhirTurun}T00:00:00Z`).getTime();
  const now = new Date(`${o.hariIni}T00:00:00Z`).getTime();
  return Number.isFinite(last) && Number.isFinite(now)
    && Math.round((now - last) / 864e5) >= Math.max(1, Math.floor(o.ambangHari));
}

export { ORDER as LOYALTY_TIERS };
