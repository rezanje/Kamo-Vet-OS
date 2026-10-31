"use client";

import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { koreksiMetodeBayarKlinik } from "./payment-correction-actions";

const rp = (n: number) => "Rp " + Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });

/** Satu bagian pembayaran Tunai/Transfer dipindah utuh ke metode lainnya. */
export function ClinicPaymentCorrectionForm({ userId, visitId, invoiceId, paymentId, revision, label, method, amount }: {
  userId: string; visitId: string; invoiceId: string; paymentId: string | null; revision: number;
  label: string; method: "Tunai" | "Transfer"; amount: number;
}) {
  const target = method === "Tunai" ? "Transfer" : "Tunai";
  const scope = `clinic-payment:${invoiceId}:${paymentId ?? "langsung"}:${revision}`;
  const id = `clinic-correction-${paymentId ?? "langsung"}`;
  return <CorrectionTransactionForm userId={userId} scope={scope} action={koreksiMetodeBayarKlinik}
    style={{ borderTop: ".5px solid var(--bd)", paddingTop: 8, marginTop: 8 }}>
    {({ ready }) => <>
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="paymentId" value={paymentId ?? ""} />
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="metode" value={target} />
      <div style={{ fontSize: 11.5 }}><b>{label}</b> · {method} {rp(amount)} → <b>{target}</b></div>
      <label className="flab" htmlFor={id}>Alasan koreksi *</label>
      <input id={id} className="fi" name="alasan" minLength={3} maxLength={1000} required
        placeholder="Contoh: pembayaran diterima via transfer, kasir memilih tunai" />
      <button className="btn-acc" type="submit" disabled={!ready} style={{ marginTop: 8 }}>Ubah ke {target}</button>
    </>}
  </CorrectionTransactionForm>;
}
