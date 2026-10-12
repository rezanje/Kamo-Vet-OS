import { METODE_BAYAR } from "./kas-akun";
import type { SplitPaymentDraft } from "./clinic-split-payment";

export type DemoFinancialPolicy = {
  id: string;
  name: string;
  incentivePercent: number;
  feeBearer: "customer" | "company";
  /** Integer basis points: 100 = 1%. */
  feeRates: Record<string, number>;
  adminRevenueCode: string;
  adminExpenseCode: string;
};

export function quoteDemoPayments(policy: DemoFinancialPolicy, payments: readonly SplitPaymentDraft[]) {
  if (!payments.length || payments.length > 6 || !["customer", "company"].includes(policy.feeBearer)) {
    throw new Error("Rincian pembayaran atau aturan DEMO tidak valid.");
  }
  const parts = payments.map(part => {
    if (!METODE_BAYAR.includes(part.method as typeof METODE_BAYAR[number]) || !Number.isSafeInteger(part.amount) || part.amount <= 0) {
      throw new Error("Isi nominal rupiah positif dan metode pembayaran yang valid.");
    }
    const rate = policy.feeRates[part.method] ?? 0;
    if (!Number.isSafeInteger(rate) || rate < 0 || rate > 10000) throw new Error("Tarif admin DEMO tidak valid.");
    const fee = Math.round(part.amount * rate / 10000);
    const gross = part.amount + (policy.feeBearer === "customer" ? fee : 0);
    const net = gross - (policy.feeBearer === "company" ? fee : 0);
    if (![fee, gross, net].every(Number.isSafeInteger) || net < 0) throw new Error("Nominal pembayaran terlalu besar.");
    return { ...part, fee, gross, net };
  });
  const total = parts.reduce((sum, part) => sum + part.fee, 0);
  if (!Number.isSafeInteger(total)) throw new Error("Nominal biaya terlalu besar.");
  return { parts, customerFee: policy.feeBearer === "customer" ? total : 0, companyFee: policy.feeBearer === "company" ? total : 0 };
}

export function allocateDemoIncentive(total: number, employeeIds: readonly string[]) {
  const ids = [...new Set(employeeIds)].sort();
  if (!Number.isSafeInteger(total) || total < 0 || ids.some(id => !id.trim()) || (total > 0 && !ids.length)) {
    throw new Error("Pilih petugas dan total insentif rupiah yang valid.");
  }
  return ids.map((employeeId, index) => ({ employeeId, amount: Math.floor(total / ids.length) + (index < total % ids.length ? 1 : 0) }));
}
