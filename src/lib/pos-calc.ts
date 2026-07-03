// Kalkulasi POS (Addendum §6) — pure, dipakai client (tampilan) + server action (otoritatif).
//
// URUTAN KALKULASI (jangan diubah, terdokumentasi utk debugging):
//   1) diskon per item  → subtotal per item = qty*harga - diskon item
//   2) diskon level transaksi (manual + voucher), di-cap sisa setelah (1)
//   3) poin redeem, di-cap sisa setelah (2)

export type CartLine = {
  qty: number;
  harga: number;
  item_discount_type?: "nominal" | "percent" | null;
  item_discount_value?: number | null;
};

export function lineDiscount(l: CartLine): number {
  const gross = l.qty * l.harga;
  const val = Number(l.item_discount_value) || 0;
  const raw = l.item_discount_type === "percent" ? Math.round((gross * val) / 100) : val;
  return Math.min(Math.max(0, raw), gross);
}

export function lineSubtotal(l: CartLine): number {
  return l.qty * l.harga - lineDiscount(l);
}

export function computeTotals(lines: CartLine[], txnDiscount: number, voucherValue: number, poinValue: number) {
  const itemsGross = lines.reduce((a, l) => a + l.qty * l.harga, 0);
  const itemDiscountTotal = lines.reduce((a, l) => a + lineDiscount(l), 0);
  const afterItems = itemsGross - itemDiscountTotal;
  const txnLevel = Math.min(afterItems, Math.max(0, txnDiscount) + Math.max(0, voucherValue));
  const afterTxn = afterItems - txnLevel;
  const poin = Math.min(afterTxn, Math.max(0, poinValue));
  return { itemsGross, itemDiscountTotal, afterItems, txnLevel, poin, total: afterTxn - poin };
}

export type PromoRule = {
  trigger_item_ids?: string[];
  min_qty?: number;
  min_subtotal?: number;
  suggest?: string;
  discount_type?: string;
  discount_value?: number;
};
export type Promo = { id: string; name: string; promo_type: string; rule: PromoRule };

// Reminder Promo (§6): match rule aktif vs isi cart — rekomendasi kasir, bukan auto-apply.
export function matchPromos(promos: Promo[], cart: { item_id: string; qty: number; harga: number }[]): Promo[] {
  const subtotal = cart.reduce((a, l) => a + l.qty * l.harga, 0);
  const totalQty = cart.reduce((a, l) => a + l.qty, 0);
  if (cart.length === 0) return [];
  return promos.filter((p) => {
    const r = p.rule ?? {};
    if (r.trigger_item_ids?.length) {
      const qty = cart.filter((c) => r.trigger_item_ids!.includes(c.item_id)).reduce((a, c) => a + c.qty, 0);
      return qty >= (r.min_qty ?? 1);
    }
    if (r.min_subtotal) return subtotal >= r.min_subtotal;
    if (r.min_qty) return totalQty >= r.min_qty;
    return false;
  });
}
