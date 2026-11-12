"use client";

import { useState } from "react";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { METODE_BAYAR, type MetodeBayar } from "@/lib/metode-bayar";
import { ubahMetodeKwitansiKlinik } from "./payment-correction-actions";

const rp = (n: number) => "Rp " + Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });

/** Satu bagian kwitansi dipindah utuh ke metode lain. Efek ke laci kasir dijelaskan sebelum Owner menekan tombol. */
export function KwitansiMetodeForm({ userId, visitId, receiptId, receiptNo, partId, revision, method, amount, shiftClosed }: {
  userId: string; visitId: string; receiptId: string; receiptNo: string; partId: string; revision: number;
  method: MetodeBayar; amount: number; shiftClosed: boolean;
}) {
  const [baru, setBaru] = useState("");
  const scope = `clinic-receipt-method:${receiptId}:${partId}:${revision}`;
  const id = `kw-metode-${partId}`;
  const lenyap = method === "Tunai" && baru !== "" && baru !== "Tunai";
  const muncul = method !== "Tunai" && baru === "Tunai";
  return <CorrectionTransactionForm userId={userId} scope={scope} action={ubahMetodeKwitansiKlinik}
    style={{ borderTop: ".5px solid var(--bd)", paddingTop: 8, marginTop: 8 }}>
    {({ ready }) => <>
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="receiptId" value={receiptId} />
      <input type="hidden" name="partId" value={partId} />
      <input type="hidden" name="revision" value={revision} />
      <div style={{ fontSize: 11.5 }}><b>{receiptNo}</b> · {method} {rp(amount)}</div>
      <label className="flab" htmlFor={`${id}-metode`}>Metode yang benar *</label>
      <select id={`${id}-metode`} className="fi" name="metode" required value={baru} onChange={(e) => setBaru(e.target.value)}>
        <option value="" disabled>Pilih metode baru</option>
        {METODE_BAYAR.filter(option => option.m !== method).map(option => <option key={option.m} value={option.m}>{option.m}</option>)}
      </select>
      {(lenyap || muncul) && <p role="status" style={{ fontSize: 11, margin: "6px 0 0" }}>
        {lenyap
          ? `Uang tunai ${rp(amount)} ini dikeluarkan dari hitungan laci shift kasir yang menerimanya${shiftClosed ? " (shift itu sudah ditutup: angka penutupannya TIDAK diubah, selisihnya dicek Finance)" : ""}.`
          : `Uang tunai ${rp(amount)} ini ditambahkan ke hitungan laci shift kasir yang menerimanya${shiftClosed ? " (shift itu sudah ditutup: angka penutupannya TIDAK diubah, selisihnya dicek Finance)" : ""}.`}
      </p>}
      <label className="flab" htmlFor={id}>Alasan *</label>
      <input id={id} className="fi" name="alasan" minLength={3} maxLength={500} required
        placeholder="Contoh: pemilik bayar QRIS, kasir memilih tunai" />
      <button className="btn-acc" type="submit" disabled={!ready || baru === ""} style={{ marginTop: 8 }}>Ubah metode pembayaran</button>
    </>}
  </CorrectionTransactionForm>;
}
