"use client";

import { CorrectionTransactionForm } from "./CorrectionTransactionForm";
import { SubmitButton } from "./SubmitButton";
import { PilihRekening, type RekeningOpsi } from "./PilihRekening";
import { bayarFaktur } from "@/app/(app)/pembelian/faktur/actions";

export type PurchasePaymentDefaults = { id: string; amount: number; metode: string; advance_id: string | null };
export function PurchasePaymentForm({ userId, invoiceId, remaining, today, accounts, advances, replacement }: {
  userId: string; invoiceId: string; remaining: number; today: string; accounts: RekeningOpsi[];
  advances: { id: string; no_um: string; sisa: number }[]; replacement?: PurchasePaymentDefaults;
}) {
  const amount = replacement ? Math.min(remaining, replacement.amount) : remaining;
  const advanceId = advances.some(a => a.id === replacement?.advance_id) ? replacement!.advance_id! : "";
  return <CorrectionTransactionForm userId={userId} scope={replacement ? `payable-replacement:${replacement.id}` : `payable-settle:${invoiceId}`} action={bayarFaktur} style={{ display: "flex", gap: 6, alignItems: "flex-end", padding: "8px 0", flexWrap: "wrap" }}>
    {({ ready }) => <>
      <input type="hidden" name="invoice_id" value={invoiceId} />
      {replacement && <input type="hidden" name="replaces_payment_id" value={replacement.id} />}
      {replacement && <p style={{ width: "100%" }}>Rincian dari pembayaran yang dibatalkan. Periksa nominal, uang muka, dan rekening sebelum menyimpan pengganti.</p>}
      <div><label className="flab" htmlFor={`amount-${invoiceId}`}>Nominal (maks Rp {remaining.toLocaleString("id-ID")})</label><input className="fi" id={`amount-${invoiceId}`} name="amount" type="number" required min={1} max={remaining} step={1} defaultValue={amount} /></div>
      <div><label className="flab" htmlFor={`method-${invoiceId}`}>Metode</label><select className="fi" id={`method-${invoiceId}`} name="metode" defaultValue={replacement?.metode ?? "Transfer"}><option>Transfer</option><option>Tunai</option><option>Debit</option></select></div>
      <PilihRekening rekening={accounts} width={150} />
      {advances.length > 0 && <div><label className="flab" htmlFor={`advance-${invoiceId}`}>Potong uang muka</label><select className="fi" id={`advance-${invoiceId}`} name="advance_id" defaultValue={advanceId}><option value="">— tidak pakai —</option>{advances.map(a => <option key={a.id} value={a.id}>{a.no_um} · sisa Rp {a.sisa.toLocaleString("id-ID")}</option>)}</select></div>}
      <div><label className="flab" htmlFor={`date-${invoiceId}`}>Tanggal</label><input className="fi" id={`date-${invoiceId}`} name="tanggal" type="date" required max={today} defaultValue={today} /></div>
      <SubmitButton className="btn-acc" disabled={!ready}>Simpan pembayaran</SubmitButton>
    </>}
  </CorrectionTransactionForm>;
}
