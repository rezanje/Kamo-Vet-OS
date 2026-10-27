"use client";

import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { koreksiHargaFaktur } from "./actions";

export function ConfirmCorrectionForm({ userId, invoiceId, lineId, revision, qty, harga, tanggal, expected }: {
  userId: string; invoiceId: string; lineId: string; revision: number; qty: string; harga: string; tanggal: string; expected: string;
}) {
  return <CorrectionTransactionForm userId={userId} scope={`purchase-invoice-reprice:${lineId}:${revision}:${qty}:${harga}:${tanggal}`} action={koreksiHargaFaktur}>
    {({ ready }) => <>
      {[["invoice_id", invoiceId], ["line_id", lineId], ["revision", String(revision)], ["qty", qty], ["harga", harga], ["tanggal", tanggal], ["expected", expected]]
        .map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <label className="flab" htmlFor="reprice-reason">Alasan koreksi</label>
      <input className="fi" id="reprice-reason" name="alasan" minLength={3} maxLength={1000} required placeholder="Mis. harga dari pemasok ternyata Rp 1.200" />
      <div style={{ marginTop: 8 }}>
        <SubmitButton className="btn-acc" disabled={!ready}>Simpan koreksi</SubmitButton>
      </div>
    </>}
  </CorrectionTransactionForm>;
}
