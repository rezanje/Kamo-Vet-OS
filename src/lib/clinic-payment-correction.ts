import { metodeBayarSah, type MetodeBayar } from "@/lib/metode-bayar";

/**
 * J02 klinik: bagian pembayaran invoice yang boleh dikoreksi ke metode lain (semua metode kasir).
 * Cermin aturan RPC correct_clinic_invoice_payment; server tetap memeriksa ulang (invoice DEMO,
 * refund, periode tertutup, rekonsiliasi bank dst. ditolak di database dengan pesan yang jelas).
 */
export type ClinicCorrectablePart = {
  paymentId: string | null;
  label: string;
  method: MetodeBayar;
  amount: number;
};

type InvoiceLike = {
  total: number | string | null;
  dp_amount: number | string | null;
  paid_status: string | null;
  metode_bayar: string | null;
  reissued_from?: string | null;
};
type PaymentLike = {
  id: string; amount: number | string | null; metode: string | null; transferred_from: string | null;
  /** Bagian milik kwitansi rawat inap: dibatalkan lewat kwitansi, bukan koreksi metode. */
  receipt_id?: string | null;
};

export function clinicCorrectableParts(invoice: InvoiceLike, payments: PaymentLike[]): ClinicCorrectablePart[] {
  const parts: ClinicCorrectablePart[] = [];
  // Pembayaran langsung: lunas sekali bayar (tanpa baris pelunasan) atau uang muka.
  // Invoice terbit ulang tidak punya pembayaran langsung; saldonya baris pindahan.
  if (!invoice.reissued_from) {
    const direct = invoice.paid_status === "Lunas" && payments.length === 0
      ? Number(invoice.total ?? 0) : Number(invoice.dp_amount ?? 0);
    if (direct > 0 && metodeBayarSah(invoice.metode_bayar)) {
      parts.push({ paymentId: null, label: payments.length === 0 && invoice.paid_status === "Lunas" ? "Pembayaran invoice" : "Uang muka",
        method: invoice.metode_bayar, amount: direct });
    }
  }
  payments.forEach((p, index) => {
    if (p.transferred_from || p.receipt_id || !metodeBayarSah(p.metode) || !(Number(p.amount) > 0)) return;
    parts.push({ paymentId: p.id, label: `Bagian pembayaran ${index + 1}`, method: p.metode, amount: Number(p.amount) });
  });
  return parts;
}
