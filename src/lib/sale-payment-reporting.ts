export const SALE_PAYMENT_METHODS = ["Tunai", "Transfer", "Debit", "Kredit", "QRIS", "E-Wallet"] as const;

export type SaleCompletion = { payment_plan?: unknown; payments_finalized_at?: string | null };
export type SalePaymentPart = { method: string; amount: number | string; coa_code?: string | null };
export type SalePaymentSource = SaleCompletion & {
  total: number | string; metode_bayar: string | null; no_struk?: string | null;
  sale_payments?: readonly SalePaymentPart[] | null;
};

/** Legacy sales are complete immediately; planned payments become sales only after finalization. */
export function isCompletedSale(sale: SaleCompletion): boolean {
  return sale.payment_plan == null || !!sale.payments_finalized_at;
}

/** Net allocations: cash change has already been excluded, so each sale still sums to its total. */
export function salePaymentAllocations(sale: SalePaymentSource): { method: string; amount: number; coa_code: string | null }[] {
  if (!isCompletedSale(sale)) throw new Error("Pembayaran belum selesai. Transaksi belum dapat ditampilkan sebagai penjualan.");
  const parts = sale.sale_payments ?? [];
  if (parts.length === 0 && Number(sale.total) === 0 && sale.metode_bayar !== "Split") return [];
  if (parts.length === 0 && sale.payment_plan == null && sale.metode_bayar !== "Split") {
    return [{ method: sale.metode_bayar ?? "Tunai", amount: Number(sale.total), coa_code: null }];
  }
  const invalid = () => new Error(`Rincian pembayaran${sale.no_struk ? ` ${sale.no_struk}` : ""} tidak lengkap atau tidak sesuai total. Periksa transaksi sebelum melanjutkan.`);
  if (parts.length === 0) throw invalid();
  const cents = (amount: number) => {
    const rounded = Math.round(amount * 100);
    if (!Number.isFinite(amount) || !Number.isSafeInteger(rounded) || rounded / 100 !== amount) throw invalid();
    return rounded;
  };
  const totalCents = cents(Number(sale.total));
  const seen = new Set<string>();
  let allocatedCents = 0;
  const allocations = parts.map(part => {
    const amountCents = cents(Number(part.amount));
    if (!(SALE_PAYMENT_METHODS as readonly string[]).includes(part.method) || seen.has(part.method) || amountCents <= 0) throw invalid();
    seen.add(part.method);
    allocatedCents += amountCents;
    return { method: part.method, amount: amountCents / 100, coa_code: part.coa_code || null };
  });
  if (!Number.isSafeInteger(allocatedCents) || allocatedCents !== totalCents) throw invalid();
  return allocations;
}

export function salePaymentRows(sales: readonly SalePaymentSource[]): { total: number; metode_bayar: string }[] {
  return sales.filter(isCompletedSale).flatMap(sale => salePaymentAllocations(sale).map(part => ({ total: part.amount, metode_bayar: part.method })));
}

export function receiptPaymentRows(sale: SalePaymentSource & { bayar: number | string; kembali: number | string }): { label: string; amount: number }[] {
  const parts = salePaymentAllocations(sale);
  const change = Number(sale.kembali) || 0;
  if (parts.length === 0) return [{ label: "Tanpa pembayaran", amount: 0 }];
  if (parts.length === 1) return [{ label: parts[0].method, amount: Number(sale.bayar) }];
  const rows = parts.map(part => ({ label: part.method, amount: part.amount }));
  const cash = parts.find(part => part.method === "Tunai");
  if (cash && change > 0) rows.push({ label: "Tunai diterima", amount: cash.amount + change });
  return rows;
}

export function salePaymentDescription(sale: SalePaymentSource): string {
  const parts = salePaymentAllocations(sale);
  if (parts.length === 0) return "Tanpa pembayaran";
  return parts.length === 1 ? parts[0].method : parts.map(part => `${part.method} Rp ${part.amount.toLocaleString("id-ID")}`).join(" + ");
}
