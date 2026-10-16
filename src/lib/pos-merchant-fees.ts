import { PosDecimal } from "@/lib/pos-money";
import { resolvePosPayments } from "@/lib/pos-payments";

export type PosMerchantPlanPart = { method: string; amount: number; fee_percent?: number; fee_amount?: number };

function rate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100
    || !new PosDecimal(value).equals(new PosDecimal(value).toDecimalPlaces(2))) {
    throw new Error("Fee merchant harus 0 sampai 100 persen dengan maksimal dua angka desimal.");
  }
  return value;
}

/** Input allocations are merchandise; returned allocations include each method's customer fee. */
export function quotePosMerchantFees({ total, method, payments, feePercent = 0 }: {
  total: number; method: string; payments?: unknown; feePercent?: number;
}): { total: number; feeTotal: number; parts: PosMerchantPlanPart[] } {
  let raw = payments;
  if (typeof raw === "string") {
    try { raw = raw.trim() ? JSON.parse(raw) : []; }
    catch { throw new Error("Rincian pembayaran gabungan tidak valid."); }
  }
  if (raw == null) raw = [];
  if (!Array.isArray(raw)) throw new Error("Rincian pembayaran gabungan tidak valid.");
  const singleRate = rate(feePercent);
  if (method === "Split" && singleRate !== 0) throw new Error("Isi fee pada masing-masing metode pembayaran gabungan.");
  if (method === "Tunai" && singleRate !== 0) throw new Error("Pembayaran tunai tidak memakai fee merchant.");
  const base = resolvePosPayments({ total, method, payments: raw,
    bayar: method === "Tunai" ? total : method === "Split" ? raw.find(part => part?.method === "Tunai")?.amount ?? 0 : 0 });
  let fees = new PosDecimal(0);
  const parts = base.parts.map((part, index): PosMerchantPlanPart => {
    const percent = method === "Split" ? rate(raw[index].feePercent ?? 0) : singleRate;
    if (part.method === "Tunai" && percent !== 0) throw new Error("Pembayaran tunai tidak memakai fee merchant.");
    if (percent === 0) return part;
    const fee = new PosDecimal(part.amount).times(percent).div(100).toDecimalPlaces(2);
    fees = fees.plus(fee);
    return { method: part.method, amount: new PosDecimal(part.amount).plus(fee).toNumber(), fee_percent: percent, fee_amount: fee.toNumber() };
  });
  const gross = new PosDecimal(total).plus(fees);
  if (gross.gt(1e12)) throw new Error("Total pembayaran terlalu besar.");
  return { total: gross.toNumber(), feeTotal: fees.toNumber(), parts };
}
