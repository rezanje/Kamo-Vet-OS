"use client";

import { useEffect, useRef, useState } from "react";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { NumberInput } from "@/components/NumberInput";
import { formatPosMoney } from "@/lib/pos-money";
import { koreksiMetodePembayaran } from "./actions";

/** Blank counts as zero: a cashier who clears Tunai means "nothing in cash". */
function cents(value: string): number | null {
  const text = value.trim();
  if (!text) return 0;
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, decimal = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}

const money = (amountCents: number) => String(amountCents / 100);

export function SalePaymentCorrectionForm({ userId, saleId, revision, cash, transfer, fixed }: {
  userId: string; saleId: string; revision: number; cash: number; transfer: number;
  fixed: { method: string; amount: number }[];
}) {
  const [cashText, setCashText] = useState(String(cash));
  const [transferText, setTransferText] = useState(String(transfer));
  const cashInput = useRef<HTMLInputElement>(null);
  const transferInput = useRef<HTMLInputElement>(null);
  const oldTotal = Math.round((cash + transfer) * 100);
  const newCash = cents(cashText);
  const newTransfer = cents(transferText);
  const balanced = newCash !== null && newTransfer !== null && newCash + newTransfer === oldTotal;
  const changed = newCash !== Math.round(cash * 100) || newTransfer !== Math.round(transfer * 100);
  const valid = balanced && changed;

  // A restored draft writes the DOM directly; mirror it so validation sees the same numbers.
  useEffect(() => {
    const pairs = [[cashInput.current, setCashText], [transferInput.current, setTransferText]] as const;
    const cleanups = pairs.map(([control, set]) => {
      const sync = () => set(control?.value ?? "");
      control?.addEventListener("vetos:numeric-sync", sync);
      return () => control?.removeEventListener("vetos:numeric-sync", sync);
    });
    return () => cleanups.forEach(cleanup => cleanup());
  }, []);

  // Editing one side fills the other so the split always adds up to the bill.
  const edit = (text: string, setSelf: (value: string) => void, setOther: (value: string) => void) => {
    setSelf(text);
    const amount = cents(text);
    if (amount !== null && amount <= oldTotal) setOther(money(oldTotal - amount));
  };

  const hint = newCash === null || newTransfer === null
    ? "Isi angka Rupiah tanpa titik pemisah ribuan."
    : !balanced ? `Tunai + Transfer sekarang ${formatPosMoney((newCash + newTransfer) / 100)}, harus ${formatPosMoney(cash + transfer)}.`
      : !changed ? "Pembagian masih sama dengan semula. Ubah angka Tunai atau Transfer dulu." : "";

  return <CorrectionTransactionForm userId={userId} scope={`sale-payment:${saleId}:${revision}`} action={koreksiMetodePembayaran}>
    {({ ready }) => <>
      <input type="hidden" name="id" value={saleId} /><input type="hidden" name="revision" value={revision} />
      <p>Ubah pembagian Tunai dan Transfer pada penjualan ini. Total tagihan dan metode pembayaran lain tetap. Jurnal lama dibalik dan jurnal baru dicatat dengan alasan koreksi.</p>
      {fixed.length > 0 && <p>Metode tetap: {fixed.map(part => `${part.method} ${formatPosMoney(part.amount)}`).join(" · ")}</p>}
      <p>Total yang dibagi: <strong>{formatPosMoney(cash + transfer)}</strong> — isi salah satu, kolom lainnya menyesuaikan otomatis.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <div><label className="flab" htmlFor="sale-correction-cash">Tunai</label>
          <NumberInput ref={cashInput} id="sale-correction-cash" className="fi" name="tunai" type="number" min="0" max="1000000000000" step="0.01" inputMode="decimal" placeholder="0"
            value={cashText} onInput={event => edit(event.currentTarget.value, setCashText, setTransferText)} /></div>
        <div><label className="flab" htmlFor="sale-correction-transfer">Transfer</label>
          <NumberInput ref={transferInput} id="sale-correction-transfer" className="fi" name="transfer" type="number" min="0" max="1000000000000" step="0.01" inputMode="decimal" placeholder="0"
            value={transferText} onInput={event => edit(event.currentTarget.value, setTransferText, setCashText)} /></div>
      </div>
      {hint && <p role="status">{hint}</p>}
      <label className="flab" htmlFor="sale-correction-reason">Alasan koreksi *</label>
      <input id="sale-correction-reason" className="fi" name="alasan" minLength={3} maxLength={1000} required placeholder="Contoh: pembayaran diterima via transfer, kasir memilih tunai" />
      <button className="btn-acc" type="submit" disabled={!ready || !valid} style={{ marginTop: 10 }}>Simpan koreksi metode</button>
    </>}
  </CorrectionTransactionForm>;
}
