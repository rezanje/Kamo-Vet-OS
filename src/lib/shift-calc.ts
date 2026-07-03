// Kalkulasi rekonsiliasi shift (Addendum §1) — pure, dipakai server action + laporan.

export const PAYMENT_METHODS = ["Tunai", "Debit", "Kredit", "QRIS", "E-Wallet"] as const;

export function methodBreakdown(sales: { total: number; metode_bayar: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of PAYMENT_METHODS) out[m] = 0;
  for (const s of sales) out[s.metode_bayar] = (out[s.metode_bayar] ?? 0) + Number(s.total);
  return out;
}

export function expectedCash(openingBalance: number, breakdown: Record<string, number>): number {
  return openingBalance + (breakdown["Tunai"] ?? 0);
}

export function cashVariance(actual: number, expected: number): number {
  return actual - expected;
}

// kas klinik masuk lewat invoice: Lunas = total, DP = dp_amount, Belum Lunas = 0.
export function invoiceCashRows(
  invoices: { total: number; dp_amount: number; paid_status: string; metode_bayar: string }[],
): { total: number; metode_bayar: string }[] {
  return invoices.map((i) => ({
    total: i.paid_status === "Lunas" ? Number(i.total) : i.paid_status === "DP" ? Number(i.dp_amount) : 0,
    metode_bayar: i.metode_bayar,
  }));
}
