import Decimal from "decimal.js";

/** Decimal arithmetic matches PostgreSQL numeric, including exact half-cent ties. */
export const PosDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export function roundPosMoney(amount: number): number {
  return new PosDecimal(amount).toDecimalPlaces(2).toNumber();
}

export function posSubtotal(lines: readonly { qty: number; harga: number }[]): number {
  return lines.reduce((sum, line) => sum.plus(new PosDecimal(line.qty).times(line.harga)), new PosDecimal(0)).toNumber();
}

export function posNetTotal(subtotal: number, ...discounts: number[]): number {
  return PosDecimal.max(0, discounts.reduce((net, discount) => net.minus(discount), new PosDecimal(subtotal))).toDecimalPlaces(2).toNumber();
}

export function formatPosMoney(amount: number): string {
  return "Rp " + roundPosMoney(Number(amount)).toLocaleString("id-ID", { maximumFractionDigits: 2 });
}
