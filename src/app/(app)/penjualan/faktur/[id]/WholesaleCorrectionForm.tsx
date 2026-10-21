"use client";

import { useState } from "react";
import Decimal from "decimal.js";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { draftRecord, draftString } from "@/components/TransactionDraft";
import { SubmitButton } from "@/components/SubmitButton";
import { koreksiFakturGrosir } from "./actions";

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
type Line = { id: string; nama: string; qty: number; harga: number; satuan: string | null };
export function WholesaleCorrectionForm({ userId, invoiceId, revision, today, due, note, paid, total, taxRate, items }: {
  userId: string; invoiceId: string; revision: number; today: string; due: string; note: string;
  paid: number; total: number; taxRate: number; items: Line[];
}) {
  const [prices, setPrices] = useState(() => Object.fromEntries(items.map(i => [i.id, String(i.harga)])));
  const [action, setAction] = useState("replace");
  let dpp = new Decimal(0);
  let valid = true;
  for (const item of items) {
    const price = Number(prices[item.id]);
    if (prices[item.id] === "" || !Number.isFinite(price) || price < 0 || price > 1000000000) { valid = false; continue; }
    dpp = dpp.plus(new Decimal(price).times(item.qty));
  }
  const newTotal = action === "cancel" ? 0 : dpp.plus(dpp.times(taxRate).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP)).toNumber();
  const credit = Math.max(0, paid - newTotal);
  return <CorrectionTransactionForm userId={userId} scope={`wholesale-correction:${invoiceId}:${revision}`} action={koreksiFakturGrosir} state={{
    snapshot: { prices, action },
    restore: value => {
      if (!draftRecord(value.prices, draftString) || Object.keys(value.prices).length !== items.length
        || !items.every(i => typeof value.prices === "object" && value.prices !== null && Object.hasOwn(value.prices, i.id))
        || !Object.values(value.prices).every(p => p.length <= 32 && (p === "" || Number.isFinite(Number(p))))
        || (value.action !== "replace" && value.action !== "cancel")) return false;
      setPrices(value.prices); setAction(value.action); return true;
    },
    reset: () => { setPrices(Object.fromEntries(items.map(i => [i.id, String(i.harga)]))); setAction("replace"); },
  }}>
    {({ ready }) => <>
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input type="hidden" name="revision" value={revision} />
      <label className="flab">Tindakan</label>
      <select className="fi" aria-label="Tindakan koreksi" name="correction_mode" value={action} onChange={e => setAction(e.target.value)}>
        <option value="replace">Koreksi harga / tempo / catatan dengan faktur pengganti</option>
        <option value="cancel">Batalkan pencatatan tagihan</option>
      </select>
      <p>Pembayaran tetap tersimpan: {rp(paid)}. Perubahan stok: 0. Barang yang sudah dikirim tetap tercatat keluar. Perubahan barang, satuan atau qty perlu rekonsiliasi pengiriman atau retur fisik.</p>
      <div className="frow">
        <div><label className="flab">Tanggal koreksi</label><input className="fi" type="date" name="tanggal" required defaultValue={today} max={today} /></div>
        <div><label className="flab">Jatuh tempo pengganti</label><input className="fi" type="date" name="jatuh_tempo" required={action === "replace"} defaultValue={due < today ? today : due} /></div>
      </div>
      <table className="tbl"><thead><tr><th>Barang terkirim</th><th>Qty tetap</th><th>Harga pengganti</th></tr></thead>
        <tbody>{items.map(item => <tr key={item.id}>
          <td>{item.nama}<input type="hidden" name="line_id" value={item.id} /></td>
          <td>{item.qty} {item.satuan}</td>
          <td><input className="fi" type="number" name={`harga_${item.id}`} aria-label={`Harga ${item.nama}`} min="0" max="1000000000" step="0.01" value={prices[item.id]} onInput={e => { const value = e.currentTarget.value; setPrices(p => ({ ...p, [item.id]: value })); }} readOnly={action === "cancel"} /></td>
        </tr>)}</tbody>
      </table>
      <div className="p2ban" aria-live="polite">
        Total {rp(total)} → {valid ? rp(newTotal) : "periksa harga"}. Sisa piutang: {valid ? rp(Math.max(0, newTotal - paid)) : "—"}.
        <div data-testid="credit-preview">Kredit pelanggan: {valid ? rp(credit) : "—"}. Kredit dicatat pada kewajiban pelanggan; penyelesaian/pengembalian perlu ditinjau keuangan. Tidak ada refund atau transfer uang dari formulir ini.</div>
        {action === "cancel" && <div>Qty dikirim tetap; sisa penagihan dibuka kembali pada pesanan.</div>}
      </div>
      <label className="flab">Catatan pengganti</label><input className="fi" name="catatan" defaultValue={note} maxLength={1000} />
      <label className="flab">Alasan koreksi (wajib)</label><input className="fi" name="alasan" required minLength={3} maxLength={1000} />
      <p style={{ fontSize: 11 }}>Preview dihitung ulang oleh server. Periode tertutup, penggajian, penerimaan yang sudah direkonsiliasi atau bukti pengiriman tidak lengkap akan memblokir koreksi dengan jalur penyelesaian.</p>
      <SubmitButton className="btn-acc" name="tindakan" value={action} disabled={!ready || !valid} pendingText="Memproses…">{action === "cancel" ? "Batalkan tagihan" : "Simpan faktur pengganti"}</SubmitButton>
      <button className="btn-def" type="submit" name="tindakan" value="periksa" formNoValidate disabled={!ready}>Periksa hasil terakhir</button>
    </>}
  </CorrectionTransactionForm>;
}
