"use client";

import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { hariIniWIB } from "@/lib/tanggal";
import { batalkanPenerimaan } from "./actions";

export function ReceiptCancelForm({ userId, receiptId }: { userId: string; receiptId: string }) {
  return <CorrectionTransactionForm userId={userId} scope={`goods-receipt-cancel:${receiptId}`} action={batalkanPenerimaan}>
    {({ ready }) => <>
      <input type="hidden" name="receipt_id" value={receiptId} />
      <p style={{ fontSize: 11, color: "var(--tm)" }}>
        Stok, jurnal persediaan, dan jumlah diterima di PO dibalik dalam satu langkah; dokumen asli tetap tersimpan dengan status dibatalkan.
        Bila masih ada pembayaran atau faktur aktif, atau barangnya sudah terpakai, sistem menolak dan menjelaskan langkah yang harus dilakukan dulu
        (urutan: batalkan pembayaran, batalkan faktur, lalu batalkan penerimaan). Stok tidak pernah dibuat minus diam-diam.
      </p>
      <label className="flab" htmlFor="receipt-cancel-reason">Alasan pembatalan</label>
      <input className="fi" id="receipt-cancel-reason" name="alasan" minLength={3} maxLength={1000} required />
      <label className="flab" htmlFor="receipt-cancel-date">Tanggal pembatalan</label>
      <input className="fi" id="receipt-cancel-date" name="tanggal" type="date" defaultValue={hariIniWIB()} max={hariIniWIB()} required />
      <div style={{ marginTop: 8 }}>
        <SubmitButton className="btn-def" name="tindakan" value="batal" disabled={!ready}>Batalkan penerimaan</SubmitButton>
      </div>
    </>}
  </CorrectionTransactionForm>;
}
