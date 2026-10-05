import { METODE_BAYAR } from "./kas-akun";

export type SplitPaymentDraft = { method: string; amount: number };
export type ClinicSplitPayment = SplitPaymentDraft & { kas_code: string };

export function parseSplitPaymentDraft(raw: string): SplitPaymentDraft[] {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Rincian pembayaran campuran tidak valid."); }
  if (!Array.isArray(value) || value.length < 2 || value.length > 6) {
    throw new Error("Pembayaran campuran harus berisi 2 sampai 6 bagian.");
  }
  return value.map(part => {
    if (!part || typeof part !== "object" || !METODE_BAYAR.includes(part.method)
      || !Number.isSafeInteger(part.amount) || part.amount <= 0) {
      throw new Error("Pilih metode dan isi nominal rupiah positif pada setiap bagian pembayaran.");
    }
    return { method: part.method, amount: part.amount };
  });
}

export function validateSplitPaymentTotal(parts: readonly { amount: number }[], total: number): void {
  const sum = parts.reduce((value, part) => value + part.amount, 0);
  if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(sum)
    || parts.some(part => !Number.isSafeInteger(part.amount) || part.amount <= 0) || sum !== total) {
    throw new Error("Jumlah pembayaran campuran harus sama dengan total tagihan. Periksa nominal setiap metode.");
  }
}
