"use client";

import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { EffectiveDateField } from "@/components/EffectiveDateField";
import { batalkanPembayaranFaktur } from "./actions";

export function PaymentCorrectionForm({ userId, invoiceId, paymentId, revision, grouped, docDate, canBackdate = false }: {
  userId: string; invoiceId: string; paymentId: string; revision: number; grouped: boolean; docDate?: string | null; canBackdate?: boolean;
}) {
  return <CorrectionTransactionForm userId={userId} scope={`purchase-payment-cancel:${paymentId}:${revision}`} action={batalkanPembayaranFaktur}>
    {({ ready }) => <>
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input type="hidden" name="payment_id" value={paymentId} />
      <input type="hidden" name="revision" value={revision} />
      <p>{grouped ? "Semua pembayaran di perintah bayar ini dibalik bersama." : "Pembayaran dibalik; hutang kembali terbuka."}</p>
      <label className="flab" htmlFor={`payment-reason-${paymentId}`}>Alasan</label>
      <input className="fi" id={`payment-reason-${paymentId}`} name="alasan" required minLength={3} maxLength={1000} />
      <EffectiveDateField id={`payment-date-${paymentId}`} docDate={docDate} canBackdate={canBackdate} />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn-def" type="submit" name="tindakan" value="periksa" formNoValidate disabled={!ready}>Periksa hasil terakhir</button>
        <SubmitButton className="btn-def" name="tindakan" value="batal" disabled={!ready}>Batalkan pembayaran</SubmitButton>
        <SubmitButton className="btn-acc" name="tindakan" value="ganti" disabled={!ready}>Batalkan &amp; siapkan pengganti</SubmitButton>
      </div>
    </>}
  </CorrectionTransactionForm>;
}
