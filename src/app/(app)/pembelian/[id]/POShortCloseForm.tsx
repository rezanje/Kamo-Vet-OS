"use client";
import { useState } from "react";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { receiptCloseSnapshot, type ReceiptCloseRow } from "@/lib/purchase-short-close";
import { closeRemainingPO } from "../actions";

export function POShortCloseForm({ userId, poId, rows, alreadyClosed = false }: { userId: string; poId: string; rows: ReceiptCloseRow[]; alreadyClosed?: boolean }) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  return <CorrectionTransactionForm userId={userId} scope={`purchase-order-short-close:${poId}`} action={closeRemainingPO} state={{ snapshot: { reason }, restore(value) {
    if (typeof value.reason !== "string") return false;
    setReason(value.reason); setConfirmed(false); return true;
  } }}>
    {({ ready }) => <>
      <input type="hidden" name="po_id" value={poId} />
      <button type="submit" formNoValidate name="tindakan" value="periksa" className="btn-def" disabled={!ready}>Periksa hasil tutup sisa</button>
      {!alreadyClosed && <>
        <input type="hidden" name="expected_rows" value={JSON.stringify(receiptCloseSnapshot(rows))} />
        <p>Untuk penerimaan terakhir: sisa tidak akan dikirim lagi. Jumlah pesanan dan barang yang sudah diterima tetap tersimpan. Faktur hanya memakai jumlah diterima yang belum ditagih.</p>
        <ul>{rows.filter(row => Number(row.qty) > Number(row.qty_terima ?? 0)).map(row => <li key={row.id}>{row.nama ?? row.id}: sisa {Number(row.qty) - Number(row.qty_terima ?? 0)} {row.satuan ?? "unit"}</li>)}</ul>
        <p>DP yang sudah ada tetap tersimpan; penutupan ini tidak mengembalikan atau mengalokasikan DP otomatis.</p>
        <label className="flab" htmlFor="po-short-close-reason">Alasan tutup sisa *</label>
        <textarea id="po-short-close-reason" className="fi" name="reason" minLength={3} maxLength={1000} required value={reason} onChange={event => setReason(event.target.value)} />
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10 }}>
          <input type="checkbox" name="confirmed" value="1" data-draft-ignore required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
          Saya memastikan sisa barang tidak akan dikirim lagi oleh pemasok.
        </label>
        <button type="submit" className="btn-acc" disabled={!ready || !confirmed} style={{ marginTop: 10 }}>Tutup sisa penerimaan</button>
      </>}
    </>}
  </CorrectionTransactionForm>;
}
