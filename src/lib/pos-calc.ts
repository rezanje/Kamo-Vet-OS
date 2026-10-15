// Kalkulasi POS (Addendum §6) — pure, dipakai client (tampilan) + server action (otoritatif).
//
// URUTAN KALKULASI (jangan diubah, terdokumentasi utk debugging):
//   1) diskon per item  → subtotal per item = qty*harga - diskon item
//   2) diskon level transaksi (manual + voucher), di-cap sisa setelah (1)
//   3) poin redeem, di-cap sisa setelah (2)
import { PosDecimal, posSubtotal } from "./pos-money";

export type CartLine = {
  qty: number;
  harga: number;
  item_discount_type?: "nominal" | "percent" | null;
  item_discount_value?: number | null;
  // Potongan promo otomatis (rupiah, migrasi 0079). Dihitung lib/promo-hitung.
  promo_discount?: number | null;
};

// Diskon manual kasir MENANG atas promo, tidak ditumpuk: kasir yang mengetik
// potongan sendiri sedang menimpa harga dengan sengaja (nego, barang cacat).
// Menumpuk keduanya diam-diam bikin harga jatuh di bawah modal tanpa disadari.
function manualDiscount(l: CartLine): number {
  const gross = new PosDecimal(l.qty).times(l.harga).toNumber();
  const val = Number(l.item_discount_value) || 0;
  return l.item_discount_type === "percent" ? new PosDecimal(gross).times(val).div(100).toDecimalPlaces(0).toNumber() : val;
}

export function lineDiscount(l: CartLine): number {
  const gross = new PosDecimal(l.qty).times(l.harga).toNumber();
  const manual = manualDiscount(l);
  const raw = manual > 0 ? manual : Math.max(0, Number(l.promo_discount) || 0);
  return Math.min(Math.max(0, raw), gross);
}

/**
 * Potongan promo yang BENAR-BENAR terpakai di baris ini — nol kalau diskon manual
 * kasir menang. Dipakai menyimpan nilai promo ke struk supaya laporan promo tahu
 * berapa uang yang keluar untuk tiap program, bukan cuma berapa kali dipakai.
 */
export function linePromoApplied(l: CartLine): number {
  const gross = new PosDecimal(l.qty).times(l.harga).toNumber();
  if (manualDiscount(l) > 0) return 0;
  return Math.min(Math.max(0, Number(l.promo_discount) || 0), gross);
}

export function lineSubtotal(l: CartLine): number {
  return new PosDecimal(l.qty).times(l.harga).minus(lineDiscount(l)).toNumber();
}

export function computeTotals(lines: CartLine[], txnDiscount: number, voucherValue: number, poinValue: number) {
  const itemsGross = posSubtotal(lines);
  const itemDiscountTotal = lines.reduce((sum, line) => sum.plus(lineDiscount(line)), new PosDecimal(0)).toNumber();
  const afterItems = new PosDecimal(itemsGross).minus(itemDiscountTotal).toNumber();
  const txnLevel = PosDecimal.min(afterItems, PosDecimal.max(0, txnDiscount).plus(PosDecimal.max(0, voucherValue))).toNumber();
  const afterTxn = new PosDecimal(afterItems).minus(txnLevel).toNumber();
  const poin = Math.min(afterTxn, Math.max(0, poinValue));
  return { itemsGross, itemDiscountTotal, afterItems, txnLevel, poin, total: new PosDecimal(afterTxn).minus(poin).toNumber() };
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
