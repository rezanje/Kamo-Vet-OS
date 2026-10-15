// Kalkulasi rekonsiliasi shift (Addendum §1) — pure, dipakai server action + laporan.
import { SALE_PAYMENT_METHODS, salePaymentRows, type SalePaymentSource } from "./sale-payment-reporting";
import { PosDecimal } from "./pos-money";

export const PAYMENT_METHODS = SALE_PAYMENT_METHODS;

export function methodBreakdown(sales: readonly SalePaymentSource[]): Record<string, number> {
  const totals = new Map<string, InstanceType<typeof PosDecimal>>();
  for (const method of PAYMENT_METHODS) totals.set(method, new PosDecimal(0));
  for (const sale of salePaymentRows(sales)) {
    totals.set(sale.metode_bayar, (totals.get(sale.metode_bayar) ?? new PosDecimal(0)).plus(sale.total));
  }
  return Object.fromEntries([...totals].map(([method, total]) => [method, total.toDecimalPlaces(2).toNumber()]));
}

// Kas seharusnya = modal awal + penjualan tunai − pengeluaran tunai (uang yang
// beneran keluar dari laci selama shift).
export function expectedCash(
  openingBalance: number,
  breakdown: Record<string, number>,
  cashExpenses = 0,
): number {
  return new PosDecimal(openingBalance).plus(breakdown["Tunai"] ?? 0).minus(cashExpenses).toDecimalPlaces(2).toNumber();
}

// Pengeluaran yang mengurangi laci = yang dibayar tunai saja (transfer/QRIS keluar
// dari bank, bukan dari kas fisik kasir).
export function cashExpenseTotal(expenses: { jumlah: number; metode_bayar: string }[]): number {
  return expenses
    .filter((e) => e.metode_bayar === "Tunai")
    .reduce((sum, expense) => sum.plus(Number(expense.jumlah || 0)), new PosDecimal(0))
    .toDecimalPlaces(2).toNumber();
}

export function cashVariance(actual: number, expected: number): number {
  const variance = new PosDecimal(actual).minus(expected).toDecimalPlaces(2).toNumber();
  return variance === 0 ? 0 : variance;
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
    /** Cash collected when the first invoice was issued, carried through reissue. */
    shift_cash_carry?: number | null;
  }[],
): { total: number; metode_bayar: string }[] {
  return invoices.map((i) => {
    const susulan = Number(i.dibayarSusulan) || 0;
    const tunaiSaatTerbit = i.shift_cash_carry != null ? Number(i.shift_cash_carry)
      : i.paid_status === "Lunas" && susulan === 0
      ? Number(i.total)
      : Number(i.dp_amount) || 0;
    return { total: tunaiSaatTerbit, metode_bayar: i.metode_bayar };
  });
}
