/**
 * J02 klinik: bagian pembayaran invoice yang boleh dikoreksi Tunai <-> Transfer.
 * Cermin aturan RPC correct_clinic_invoice_payment; server tetap memeriksa ulang.
 */
export type ClinicCorrectablePart = {
  paymentId: string | null;
  label: string;
  method: "Tunai" | "Transfer";
  amount: number;
};

type InvoiceLike = {
  total: number | string | null;
  dp_amount: number | string | null;
  paid_status: string | null;
  metode_bayar: string | null;
  reissued_from?: string | null;
};
type PaymentLike = { id: string; amount: number | string | null; metode: string | null; transferred_from: string | null };

const isCashOrTransfer = (method: string | null): method is "Tunai" | "Transfer" => method === "Tunai" || method === "Transfer";

export function clinicCorrectableParts(invoice: InvoiceLike, payments: PaymentLike[]): ClinicCorrectablePart[] {
  const parts: ClinicCorrectablePart[] = [];
  // Pembayaran langsung: lunas sekali bayar (tanpa baris pelunasan) atau uang muka.
  // Invoice terbit ulang tidak punya pembayaran langsung; saldonya baris pindahan.
  if (!invoice.reissued_from) {
    const direct = invoice.paid_status === "Lunas" && payments.length === 0
      ? Number(invoice.total ?? 0) : Number(invoice.dp_amount ?? 0);
    if (direct > 0 && isCashOrTransfer(invoice.metode_bayar)) {
      parts.push({ paymentId: null, label: payments.length === 0 && invoice.paid_status === "Lunas" ? "Pembayaran invoice" : "Uang muka",
        method: invoice.metode_bayar, amount: direct });
    }
  }
  payments.forEach((p, index) => {
    if (p.transferred_from || !isCashOrTransfer(p.metode) || !(Number(p.amount) > 0)) return;
    parts.push({ paymentId: p.id, label: `Bagian pembayaran ${index + 1}`, method: p.metode, amount: Number(p.amount) });
  });
  return parts;
}
