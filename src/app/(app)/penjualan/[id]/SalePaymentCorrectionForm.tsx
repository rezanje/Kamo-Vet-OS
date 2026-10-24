"use client";

import { useState } from "react";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { NumberInput } from "@/components/NumberInput";
import { formatPosMoney } from "@/lib/pos-money";
import { koreksiMetodePembayaran } from "./actions";

function cents(value: string): number | null {
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, decimal = ""] = value.split(".");
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}

export function SalePaymentCorrectionForm({ userId, saleId, revision, cash, transfer, fixed }: {
  userId: string; saleId: string; revision: number; cash: number; transfer: number;
  fixed: { method: string; amount: number }[];
}) {
  const [cashText, setCashText] = useState(String(cash));
  const [transferText, setTransferText] = useState(String(transfer));
  const oldTotal = Math.round((cash + transfer) * 100);
  const newCash = cents(cashText);
  const newTransfer = cents(transferText);
  const valid = newCash !== null && newTransfer !== null && newCash + newTransfer === oldTotal
    && (newCash !== Math.round(cash * 100) || newTransfer !== Math.round(transfer * 100));
  return <CorrectionTransactionForm userId={userId} scope={`sale-payment:${saleId}:${revision}`} action={koreksiMetodePembayaran}>
    {({ ready }) => <>
      <input type="hidden" name="id" value={saleId} /><input type="hidden" name="revision" value={revision} />
      <p>Ubah pembagian Tunai dan Transfer pada penjualan ini. Total tagihan dan metode pembayaran lain tetap. Jurnal lama dibalik dan jurnal baru dicatat dengan alasan koreksi.</p>
      {fixed.length > 0 && <p>Metode tetap: {fixed.map(part => `${part.method} ${formatPosMoney(part.amount)}`).join(" · ")}</p>}
      <p>Total yang dibagi: <strong>{formatPosMoney(cash + transfer)}</strong></p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <div><label className="flab" htmlFor="sale-correction-cash">Tunai *</label>
          <NumberInput id="sale-correction-cash" className="fi" name="tunai" type="number" min="0" max="1000000000000" step="0.01" inputMode="decimal" required
            value={cashText} onInput={event => setCashText(event.currentTarget.value)} /></div>
        <div><label className="flab" htmlFor="sale-correction-transfer">Transfer *</label>
          <NumberInput id="sale-correction-transfer" className="fi" name="transfer" type="number" min="0" max="1000000000000" step="0.01" inputMode="decimal" required
            value={transferText} onInput={event => setTransferText(event.currentTarget.value)} /></div>
      </div>
      {!valid && <p role="status">Jumlah Tunai dan Transfer harus tetap {formatPosMoney(cash + transfer)} dan berbeda dari pembagian semula.</p>}
      <label className="flab" htmlFor="sale-correction-reason">Alasan koreksi *</label>
      <input id="sale-correction-reason" className="fi" name="alasan" minLength={3} maxLength={1000} required placeholder="Contoh: pembayaran diterima via transfer, kasir memilih tunai" />
      <button className="btn-acc" type="submit" disabled={!ready || !valid} style={{ marginTop: 10 }}>Simpan koreksi metode</button>
    </>}
  </CorrectionTransactionForm>;
}
