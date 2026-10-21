"use client";

import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { batalkanPembayaranFaktur } from "./actions";

export function PaymentCorrectionForm({ userId, invoiceId, paymentId, revision, grouped }: {
  userId: string; invoiceId: string; paymentId: string; revision: number; grouped: boolean;
}) {
  return <CorrectionTransactionForm userId={userId} scope={`purchase-payment-cancel:${paymentId}:${revision}`} action={batalkanPembayaranFaktur}>
    {({ ready }) => <>
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input type="hidden" name="payment_id" value={paymentId} />
      <input type="hidden" name="revision" value={revision} />
      <p>{grouped ? "Seluruh pembayaran dalam perintah bayar ini akan dibalik bersama dan perintahnya kembali siap dibayar." : "Pembayaran ini akan dibalik; hutang kembali terbuka dan uang muka yang terpakai dikembalikan."} Pastikan pengembalian uang sesuai transaksi sebenarnya.</p>
      <label className="flab" htmlFor={`payment-reason-${paymentId}`}>Alasan pembatalan atau koreksi</label>
      <input className="fi" id={`payment-reason-${paymentId}`} name="alasan" required minLength={3} maxLength={1000} />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn-def" type="submit" name="tindakan" value="periksa" formNoValidate disabled={!ready}>Periksa hasil terakhir</button>
        <SubmitButton className="btn-def" name="tindakan" value="batal" disabled={!ready}>Batalkan pembayaran</SubmitButton>
        <SubmitButton className="btn-acc" name="tindakan" value="ganti" disabled={!ready}>Batalkan &amp; siapkan pengganti</SubmitButton>
      </div>
    </>}
  </CorrectionTransactionForm>;
}
