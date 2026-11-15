"use client";

import { useState } from "react";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { NumberInput } from "@/components/NumberInput";
import { formatPosMoney } from "@/lib/pos-money";
import type { BatasTanggal } from "@/lib/tanggal-efektif-petshop";
import { TanggalEfektifField } from "./TanggalEfektifField";
import { batalkanPenerimaan, batalkanPencairan, terimaPembayaranUlang } from "./actions";

const METHODS = ["Tunai", "Transfer", "Debit", "Kredit", "QRIS", "E-Wallet"] as const;

/** Rupiah ke sen; kosong = 0; null bila bukan angka Rupiah dengan maksimal dua desimal. */
function cents(value: string): number | null {
  const text = value.trim();
  if (!text) return 0;
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, decimal = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}

/** Tombol "Batalkan penerimaan": konfirmasi + alasan wajib. Uang keluar dari kas/bank, struk menjadi belum dibayar. */
export function SaleReceiptCancelForm({ userId, saleId, revision, total, shiftClosed, ubahTerhalang = [], batasTanggal }: {
  userId: string; saleId: string; revision: number; total: number; shiftClosed: boolean; ubahTerhalang?: string[]; batasTanggal?: BatasTanggal | null;
}) {
  return <CorrectionTransactionForm userId={userId} scope={`sale-receipt-cancel:${saleId}:${revision}`} action={batalkanPenerimaan}>
    {({ ready }) => <>
      <input type="hidden" name="id" value={saleId} /><input type="hidden" name="revision" value={revision} />
      <p><strong>Batalkan penerimaan</strong>: struk kembali belum dibayar ({formatPosMoney(total)} keluar dari kas/bank). Sesudah itu ubah transaksi, lalu terima pembayaran lagi.</p>
      {ubahTerhalang.length > 0 && <p role="alert"><strong>Perhatian:</strong> {ubahTerhalang.join(" dan ")}, jadi isi struk tidak bisa diubah. Sesudah dibatalkan hanya bisa terima pembayaran lagi dengan total yang sama.</p>}
      {shiftClosed && <p role="note">Shift struk sudah ditutup; pengembalian dicatat di shift terbuka Anda (bila tidak ada, ditandai &quot;tanpa shift&quot;).</p>}
      {batasTanggal && <TanggalEfektifField batas={batasTanggal} idPrefix="receipt-cancel" jenis="batal" />}
      <label className="flab" htmlFor="receipt-cancel-reason">Alasan *</label>
      <input id="receipt-cancel-reason" className="fi" name="alasan" minLength={3} maxLength={1000} required placeholder="Contoh: pelanggan bayar QRIS, kasir memilih tunai" />
      <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
        <input type="checkbox" name="konfirmasi" value="ya" required /> Saya mengerti: uang keluar dari kas/bank dan struk belum dibayar.
      </label>
      <button className="btn-def" type="submit" disabled={!ready} style={{ marginTop: 10 }}>Batalkan penerimaan</button>
    </>}
  </CorrectionTransactionForm>;
}

/** Terima pembayaran lagi: bagian metode diisi dari penerimaan lama; jumlahnya harus sama dengan total struk. */
export function SaleReceiveAgainForm({ userId, saleId, revision, total, previous, batasTanggal }: {
  userId: string; saleId: string; revision: number; total: number; previous: { method: string; amount: number }[]; batasTanggal?: BatasTanggal | null;
}) {
  const initial = Object.fromEntries(METHODS.map(method => [method, String(previous.find(part => part.method === method)?.amount ?? "")]));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const parsed = METHODS.map(method => cents(values[method] ?? ""));
  const bad = parsed.some(value => value === null);
  const sum = bad ? 0 : parsed.reduce<number>((a, b) => a + (b ?? 0), 0);
  const totalCents = Math.round(total * 100);
  const balanced = !bad && sum === totalCents && parsed.some(value => (value ?? 0) > 0);
  const hint = bad ? "Isi angka Rupiah tanpa titik pemisah ribuan, maksimal dua desimal."
    : !balanced ? `Jumlah sekarang ${formatPosMoney(sum / 100)}, harus sama dengan total struk ${formatPosMoney(total)}.` : "";
  return <CorrectionTransactionForm userId={userId} scope={`sale-receipt-receive:${saleId}:${revision}`} action={terimaPembayaranUlang}>
    {({ ready }) => <>
      <input type="hidden" name="id" value={saleId} /><input type="hidden" name="revision" value={revision} />
      <p><strong>Terima pembayaran</strong>: jumlah harus sama dengan total {formatPosMoney(total)}.</p>
      {batasTanggal && <TanggalEfektifField batas={batasTanggal} idPrefix="receipt-receive" jenis="terima" alasanWajibMundur />}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {METHODS.map(method => <div key={method}>
          <label className="flab" htmlFor={`receipt-receive-${method}`}>{method}</label>
          <NumberInput id={`receipt-receive-${method}`} className="fi" name={`amount_${method}`} type="number" min="0" max="1000000000000" step="0.01" inputMode="decimal" placeholder="0"
            value={values[method]} onInput={event => { const text = event.currentTarget.value; setValues(current => ({ ...current, [method]: text })); }} />
        </div>)}
      </div>
      {hint && <p role="status">{hint}</p>}
      <button className="btn-acc" type="submit" disabled={!ready || !balanced} style={{ marginTop: 10 }}>Terima pembayaran</button>
    </>}
  </CorrectionTransactionForm>;
}

/** Order marketplace yang sudah dicairkan: batalkan pencairan -> kembali ke piutang marketplace. */
export function OnlineDisbursementCancelForm({ userId, saleId, revision, batasTanggal }: { userId: string; saleId: string; revision: number; batasTanggal?: BatasTanggal | null }) {
  return <CorrectionTransactionForm userId={userId} scope={`sale-disbursement-cancel:${saleId}:${revision}`} action={batalkanPencairan}>
    {({ ready }) => <>
      <input type="hidden" name="id" value={saleId} /><input type="hidden" name="revision" value={revision} />
      <p><strong>Batalkan pencairan</strong>: order kembali menjadi <em>piutang marketplace</em>.</p>
      {batasTanggal && <TanggalEfektifField batas={batasTanggal} idPrefix="disb-cancel" jenis="pencairan" />}
      <label className="flab" htmlFor="disb-cancel-reason">Alasan *</label>
      <input id="disb-cancel-reason" className="fi" name="alasan" minLength={3} maxLength={1000} required placeholder="Contoh: nominal pencairan salah ketik" />
      <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
        <input type="checkbox" name="konfirmasi" value="ya" required /> Saya mengerti: dana keluar dari bank dan order kembali piutang marketplace.
      </label>
      <button className="btn-def" type="submit" disabled={!ready} style={{ marginTop: 10 }}>Batalkan pencairan</button>
    </>}
  </CorrectionTransactionForm>;
}
