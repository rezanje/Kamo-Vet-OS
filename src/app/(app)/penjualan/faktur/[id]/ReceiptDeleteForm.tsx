"use client";

import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { hapusPenerimaanJual } from "./line-actions";

/**
 * Hapus satu Penerimaan Penjualan dengan alasan wajib. Uangnya tidak dihapus dari
 * pembukuan: jurnalnya dibalik dan baris penerimaan lawan dicatat, jadi riwayatnya utuh.
 */
export function ReceiptDeleteForm({ userId, invoiceId, receiptId, noTerima, revision, dariUangMuka }: {
  userId: string; invoiceId: string; receiptId: string; noTerima: string; revision: number; dariUangMuka: number;
}) {
  return <details>
    <summary className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, cursor: "pointer", listStyle: "none", display: "inline-block" }}>
      <i className="ti ti-trash" /> Hapus penerimaan
    </summary>
    <CorrectionTransactionForm userId={userId} scope={`sales-receipt-cancel:${receiptId}:${revision}`} action={hapusPenerimaanJual}>
      {({ ready }) => <>
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <input type="hidden" name="receipt_id" value={receiptId} />
        <input type="hidden" name="revision" value={revision} />
        <p style={{ fontSize: 11 }}>
          Penerimaan {noTerima} akan dibalik: piutang faktur terbuka lagi dan jurnalnya dibalik dengan jurnal pembalik.
          {dariUangMuka > 0 ? " Porsi dari uang muka dikembalikan ke sisa uang muka pelanggan." : " Pastikan uangnya memang dikembalikan atau tidak pernah masuk."}
        </p>
        <label className="flab" htmlFor={`receipt-reason-${receiptId}`}>Alasan penghapusan *</label>
        <input className="fi" id={`receipt-reason-${receiptId}`} name="alasan" required minLength={3} maxLength={1000} />
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button className="btn-def" type="submit" name="tindakan" value="periksa" formNoValidate disabled={!ready}>Periksa hasil terakhir</button>
          <SubmitButton className="btn-acc" name="tindakan" value="hapus" disabled={!ready} pendingText="Menghapus…">Hapus penerimaan</SubmitButton>
        </div>
      </>}
    </CorrectionTransactionForm>
  </details>;
}
