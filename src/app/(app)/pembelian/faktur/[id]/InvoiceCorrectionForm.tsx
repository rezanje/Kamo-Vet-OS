"use client";

import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { hariIniWIB } from "@/lib/tanggal";
import { batalkanFakturPembelian } from "./actions";

export function InvoiceCorrectionForm({ userId, invoiceId, revision, voided }: { userId: string; invoiceId: string; revision: number; voided: boolean }) {
  return <CorrectionTransactionForm userId={userId} scope={`purchase-invoice-cancel:${invoiceId}:${voided ? revision - 1 : revision}`} action={batalkanFakturPembelian}>
    {({ ready }) => <>
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input type="hidden" name="revision" value={revision} />
      <p>Pembayaran harus dibalik terlebih dahulu. Barang yang sudah terpakai atau nilai yang berubah perlu direkonsiliasi.</p>
      <label className="flab" htmlFor="invoice-cancel-reason">Alasan pembatalan atau koreksi</label>
      <input className="fi" id="invoice-cancel-reason" name="alasan" minLength={3} maxLength={1000} required disabled={voided} />
      <label className="flab" htmlFor="invoice-cancel-date">Tanggal pembatalan</label>
      <input className="fi" id="invoice-cancel-date" name="tanggal" type="date" defaultValue={hariIniWIB()} max={hariIniWIB()} required disabled={voided} />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn-def" type="submit" name="tindakan" value="periksa" formNoValidate disabled={!ready}>Periksa hasil terakhir</button>
        {!voided && <><SubmitButton className="btn-def" name="tindakan" value="batal" disabled={!ready}>Batalkan faktur</SubmitButton>
          <SubmitButton className="btn-acc" name="tindakan" value="ganti" disabled={!ready}>Batalkan &amp; siapkan pengganti</SubmitButton></>}
      </div>
    </>}
  </CorrectionTransactionForm>;
}
