"use client";

import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { batalReturGrosir } from "../actions";

/** Pembatalan retur (OWNER/FINANCE). Dokumen asli tetap tersimpan; semua efeknya dibalik. */
export function ReturGrosirVoidForm({ userId, returnId, invoiceId, revision, noRetur }: {
  userId: string; returnId: string; invoiceId: string; revision: number; noRetur: string;
}) {
  return <details>
    <summary className="btn-def" style={{ padding: "5px 12px", fontSize: 11, cursor: "pointer", listStyle: "none", display: "inline-block" }}>
      <i className="ti ti-arrow-back-up" /> Batalkan retur
    </summary>
    <CorrectionTransactionForm userId={userId} scope={`wholesale-return-void:${returnId}:${revision}`} action={batalReturGrosir}>
      {({ ready }) => <>
        <input type="hidden" name="return_id" value={returnId} />
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <input type="hidden" name="revision" value={revision} />
        <p style={{ fontSize: 11.5 }}>
          Retur {noRetur} akan dibatalkan: barangnya keluar lagi dari gudang pada modal yang sama, jurnalnya dibalik,
          dan piutang atau kredit pelanggan dikembalikan seperti sebelum retur. Ditolak kalau barang retur sudah terpakai.
        </p>
        <label className="flab" htmlFor={`void-reason-${returnId}`}>Alasan pembatalan *</label>
        <input className="fi" id={`void-reason-${returnId}`} name="alasan" required minLength={3} maxLength={1000} />
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button className="btn-def" type="submit" name="tindakan" value="periksa" formNoValidate disabled={!ready}>Periksa hasil terakhir</button>
          <SubmitButton className="btn-acc" name="tindakan" value="batal" disabled={!ready} pendingText="Membatalkan…">Batalkan retur</SubmitButton>
        </div>
      </>}
    </CorrectionTransactionForm>
  </details>;
}
