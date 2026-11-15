"use client";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { bukaKembaliSisaPO } from "../actions";

/** Buka kembali sisa PO yang sudah ditutup: bukti tutup sisa diarsipkan (tidak dihapus), PO terbuka lagi. */
export function POReopenForm({ userId, poId }: { userId: string; poId: string }) {
  return <CorrectionTransactionForm userId={userId} scope={`purchase-order-reopen:${poId}`} action={bukaKembaliSisaPO}>
    {({ ready }) => <details style={{ marginTop: 12 }}>
      <summary className="btn-def">Buka kembali sisa PO</summary>
      <input type="hidden" name="po_id" value={poId} />
      <p style={{ fontSize: 11, color: "var(--tm)" }}>
        Dipakai bila pemasok ternyata masih mengirim sisanya, atau penerimaan di PO ini perlu dibatalkan (penerimaan PO yang sisanya ditutup tidak bisa dibatalkan).
        Bukti tutup sisa tersimpan di arsip; penerimaan tidak dibuat atau dihapus.
      </p>
      <label className="flab" htmlFor="po-reopen-reason">Alasan membuka kembali *</label>
      <input className="fi" id="po-reopen-reason" name="alasan" minLength={3} maxLength={1000} required />
      <div style={{ marginTop: 8 }}><SubmitButton className="btn-def" disabled={!ready}>Buka kembali sisa PO</SubmitButton></div>
    </details>}
  </CorrectionTransactionForm>;
}
