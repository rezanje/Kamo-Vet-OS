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

/**
 * Uang yang benar-benar diterima di meja klinik SAAT invoice terbit.
 *
 * Bukan dari `paid_status` sekarang: status itu bisa berubah setelah shiftnya
 * lewat. Invoice DP yang belakangan dilunasi lewat layar Piutang (transfer ke
 * bank) berubah jadi "Lunas", dan kalau shift aslinya masih terbuka, target kas
 * kasir ikut melonjak sebesar seluruh tagihan — padahal uangnya tidak pernah
 * masuk lacinya. Pelunasan susulan punya jurnalnya sendiri, jadi di sini yang
 * dihitung hanya posisi saat terbit.
 *
 * Aturannya sama dengan detektor drift di layar Sinkron: Lunas TANPA pelunasan
 * tercatat = dibayar penuh di meja; selain itu = sebesar DP-nya saja.
 */
export function invoiceCashRows(
  invoices: {
    total: number; dp_amount: number; paid_status: string; metode_bayar: string;
    /** Total pelunasan susulan yang tercatat untuk invoice ini. */
    dibayarSusulan?: number;
  }[],
): { total: number; metode_bayar: string }[] {
  return invoices.map((i) => {
    const susulan = Number(i.dibayarSusulan) || 0;
    const tunaiSaatTerbit = i.paid_status === "Lunas" && susulan === 0
      ? Number(i.total)
      : Number(i.dp_amount) || 0;
    return { total: tunaiSaatTerbit, metode_bayar: i.metode_bayar };
  });
}
