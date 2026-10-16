export const POS_PAYMENT_METHODS = ["Tunai", "Transfer", "Debit", "Kredit", "QRIS", "E-Wallet"] as const;

export type PosPaymentPart = { method: string; amount: number; feePercent?: number };

function cents(amount: number): number {
  const value = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(value) || value / 100 !== amount) {
    throw new Error("Nominal pembayaran harus valid dengan maksimal dua angka desimal.");
  }
  return value;
}

/** Allocations are net sale receipts; cash received may also include change. */
export function resolvePosPayments({ total, method, bayar, payments }: {
  total: number;
  method: string;
  bayar: number;
  payments?: unknown;
}): { parts: PosPaymentPart[]; method: string; bayar: number; kembali: number } {
  const totalCents = cents(total);
  const receivedCents = cents(bayar);

  let value = payments;
  if (typeof value === "string") {
    try { value = value.trim() ? JSON.parse(value) : []; }
    catch { throw new Error("Rincian pembayaran gabungan tidak valid."); }
  }
  if (value == null) value = [];
  if (!Array.isArray(value)) throw new Error("Rincian pembayaran gabungan tidak valid.");

  if (method !== "Split") {
    if (!(POS_PAYMENT_METHODS as readonly string[]).includes(method)) throw new Error("Pilih metode pembayaran yang valid.");
    if (value.length) throw new Error("Aktifkan Bayar Gabungan untuk membagi pembayaran.");
    if (method === "Tunai" && bayar < total) throw new Error("Uang bayar kurang.");
    const kembali = method === "Tunai" ? (receivedCents - totalCents) / 100 : 0;
    return { parts: total > 0 ? [{ method, amount: total }] : [], method, bayar: method === "Tunai" ? bayar : total, kembali };
  }

  if (total <= 0) throw new Error("Tagihan nol tidak memerlukan pembayaran gabungan.");
  if (value.length < 1 || value.length > POS_PAYMENT_METHODS.length) throw new Error("Pembayaran gabungan harus berisi 1 sampai 6 metode.");
  const seen = new Set<string>();
  const parts: PosPaymentPart[] = value.map(part => {
    if (!part || typeof part !== "object" || !(POS_PAYMENT_METHODS as readonly unknown[]).includes(part.method)
      || typeof part.amount !== "number" || !Number.isFinite(part.amount) || part.amount <= 0) {
      throw new Error("Pilih metode dan isi nominal positif pada setiap pembayaran.");
    }
    if (seen.has(part.method)) throw new Error("Setiap metode pembayaran hanya boleh dipakai sekali.");
    cents(part.amount);
    seen.add(part.method);
    return { method: part.method, amount: part.amount };
  });
  const allocatedCents = parts.reduce((sum, part) => sum + cents(part.amount), 0);
  if (allocatedCents !== totalCents) throw new Error("Jumlah pembayaran gabungan harus sama dengan total tagihan.");
  const cashCents = cents(parts.find(part => part.method === "Tunai")?.amount ?? 0);
  if (cashCents === 0 && receivedCents !== 0) throw new Error("Uang tunai hanya diisi jika ada bagian pembayaran tunai.");
  if (receivedCents < cashCents) throw new Error("Uang tunai yang diterima kurang.");
  const changeCents = receivedCents - cashCents;
  if (!Number.isSafeInteger(totalCents + changeCents)) throw new Error("Nominal pembayaran terlalu besar.");
  return { parts, method: "Split", bayar: (totalCents + changeCents) / 100, kembali: changeCents / 100 };
}
