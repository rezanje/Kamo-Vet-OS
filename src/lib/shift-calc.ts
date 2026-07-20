// Kalkulasi rekonsiliasi shift (Addendum §1) — pure, dipakai server action + laporan.

export const PAYMENT_METHODS = ["Tunai", "Debit", "Kredit", "QRIS", "E-Wallet"] as const;

export function methodBreakdown(sales: { total: number; metode_bayar: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of PAYMENT_METHODS) out[m] = 0;
  for (const s of sales) out[s.metode_bayar] = (out[s.metode_bayar] ?? 0) + Number(s.total);
  return out;
}

// Kas seharusnya = modal awal + penjualan tunai − pengeluaran tunai (uang yang
// beneran keluar dari laci selama shift).
export function expectedCash(
  openingBalance: number,
  breakdown: Record<string, number>,
  cashExpenses = 0,
): number {
  return openingBalance + (breakdown["Tunai"] ?? 0) - cashExpenses;
}

// Pengeluaran yang mengurangi laci = yang dibayar tunai saja (transfer/QRIS keluar
// dari bank, bukan dari kas fisik kasir).
export function cashExpenseTotal(expenses: { jumlah: number; metode_bayar: string }[]): number {
  return expenses
    .filter((e) => e.metode_bayar === "Tunai")
    .reduce((a, e) => a + Number(e.jumlah || 0), 0);
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
