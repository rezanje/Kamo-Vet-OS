"use client";

import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { METODE_BAYAR, type MetodeBayar } from "@/lib/metode-bayar";
import { koreksiMetodeBayarKlinik } from "./payment-correction-actions";

const rp = (n: number) => "Rp " + Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });

/** Satu bagian pembayaran dipindah utuh ke metode lain (daftar dari satu sumber: metode-bayar.ts). */
export function ClinicPaymentCorrectionForm({ userId, visitId, invoiceId, paymentId, revision, label, method, amount }: {
  userId: string; visitId: string; invoiceId: string; paymentId: string | null; revision: number;
  label: string; method: MetodeBayar; amount: number;
}) {
  const scope = `clinic-payment:${invoiceId}:${paymentId ?? "langsung"}:${revision}`;
  const id = `clinic-correction-${paymentId ?? "langsung"}`;
  const selectId = `${id}-metode`;
  return <CorrectionTransactionForm userId={userId} scope={scope} action={koreksiMetodeBayarKlinik}
    style={{ borderTop: ".5px solid var(--bd)", paddingTop: 8, marginTop: 8 }}>
    {({ ready }) => <>
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="paymentId" value={paymentId ?? ""} />
      <input type="hidden" name="revision" value={revision} />
      <div style={{ fontSize: 11.5 }}><b>{label}</b> · {method} {rp(amount)}</div>
      <label className="flab" htmlFor={selectId}>Metode yang benar *</label>
      <select id={selectId} className="fi" name="metode" required defaultValue="">
        <option value="" disabled>Pilih metode baru</option>
        {METODE_BAYAR.filter(option => option.m !== method).map(option => <option key={option.m} value={option.m}>{option.m}</option>)}
      </select>
      <label className="flab" htmlFor={id}>Alasan koreksi *</label>
      <input id={id} className="fi" name="alasan" minLength={3} maxLength={1000} required
        placeholder="Contoh: pembayaran diterima via QRIS, kasir memilih tunai" />
      <button className="btn-acc" type="submit" disabled={!ready} style={{ marginTop: 8 }}>Ubah metode pembayaran</button>
    </>}
  </CorrectionTransactionForm>;
}
