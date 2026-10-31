"use client";

import { useState } from "react";
import { NumberInput } from "@/components/NumberInput";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { draftRecord, draftString } from "@/components/TransactionDraft";
import { SubmitButton } from "@/components/SubmitButton";
import { pratinjauRetur, sisaQtyRetur, type BarisFakturRetur, type ReturAktif } from "@/lib/retur-grosir";
import { buatReturGrosir } from "../actions";

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;

export function ReturGrosirForm({ userId, invoiceId, revision, today, minDate, faktur, baris, aktif, sisaPiutang, gudang }: {
  userId: string; invoiceId: string; revision: number; today: string; minDate: string;
  faktur: { dpp: number; ppn: number }; baris: BarisFakturRetur[]; aktif: ReturAktif[]; sisaPiutang: number;
  gudang: { id: string; name: string }[];
}) {
  const kosong = () => Object.fromEntries(baris.map((b) => [b.id, ""]));
  const [qty, setQty] = useState<Record<string, string>>(kosong);
  const [warehouse, setWarehouse] = useState(gudang[0]?.id ?? "");
  const sisa = sisaQtyRetur(baris, aktif);
  const angka = Object.fromEntries(Object.entries(qty).map(([id, v]) => [id, v === "" ? 0 : Number(v.replace(",", "."))]));
  const hasil = pratinjauRetur({ faktur, baris, aktif, qty: angka, sisaPiutang });
  const butuhGudang = baris.some((b) => b.stok && (angka[b.id] ?? 0) > 0);
  return <CorrectionTransactionForm userId={userId} scope={`wholesale-return:${invoiceId}:${revision}`} action={buatReturGrosir} state={{
    snapshot: { qty, warehouse },
    restore: (value) => {
      if (!draftRecord(value.qty, draftString) || typeof value.warehouse !== "string"
        || !baris.every((b) => Object.hasOwn(value.qty as object, b.id))
        || !Object.values(value.qty as Record<string, string>).every((v) => v.length <= 32 && (v === "" || Number.isFinite(Number(v.replace(",", "."))))))
        return false;
      setQty(value.qty as Record<string, string>); setWarehouse(value.warehouse); return true;
    },
    reset: () => { setQty(kosong()); setWarehouse(gudang[0]?.id ?? ""); },
  }}>
    {({ ready }) => <>
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <div className="frow">
        <div><label className="flab" htmlFor="retur-tanggal">Tanggal retur</label>
          <input className="fi" id="retur-tanggal" type="date" name="tanggal" required defaultValue={today} min={minDate} max={today} /></div>
        <div><label className="flab" htmlFor="retur-gudang">Gudang penerima barang</label>
          <select className="fi" id="retur-gudang" name="warehouse_id" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} required={butuhGudang}>
            {gudang.length === 0 && <option value="">Tidak ada gudang aktif di cabang faktur</option>}
            {gudang.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select></div>
      </div>
      <div style={{ overflowX: "auto" }}><table className="tbl"><thead><tr>
        <th>Barang</th><th>Qty faktur</th><th>Sisa bisa diretur</th><th>Harga</th><th>Qty retur</th><th>Kedaluwarsa (opsional)</th>
      </tr></thead><tbody>
        {baris.map((b) => <tr key={b.id}>
          <td>{b.nama}{!b.stok && <div style={{ fontSize: 10.5, color: "var(--tm)" }}>Jasa/non-stok: tidak masuk gudang</div>}<input type="hidden" name="line_id" value={b.id} /></td>
          <td>{b.qty} {b.satuan}</td>
          <td>{sisa.get(b.id) ?? 0} {b.satuan}</td>
          <td>{rp(b.harga)}{b.diskon > 0 && <div style={{ fontSize: 10.5 }}>diskon baris {rp(b.diskon)}</div>}</td>
          <td><NumberInput className="fi" type="number" name={`qty_${b.id}`} aria-label={`Qty retur ${b.nama}`} min="0" max={String(sisa.get(b.id) ?? 0)} step="any"
            value={qty[b.id]} disabled={(sisa.get(b.id) ?? 0) <= 0}
            onInput={(e) => { const value = e.currentTarget.value; setQty((q) => ({ ...q, [b.id]: value })); }} /></td>
          <td>{b.stok ? <input className="fi" type="date" name={`exp_${b.id}`} aria-label={`Kedaluwarsa ${b.nama}`} /> : "—"}</td>
        </tr>)}
      </tbody></table></div>
      <div className="p2ban" aria-live="polite" data-testid="return-preview">
        {hasil.valid ? <>
          Nilai retur {rp(hasil.total)} (pendapatan {rp(hasil.gross)}{hasil.diskon > 0 ? ` − diskon ${rp(hasil.diskon)}` : ""}{hasil.ppn > 0 ? ` + PPN ${rp(hasil.ppn)}` : ""}).
          <div>Mengurangi piutang faktur: {rp(hasil.piutang)} · Menjadi kredit pelanggan: {rp(hasil.kredit)}</div>
          <div>Modal barang kembali ke gudang: {rp(hasil.hpp)} (HPP asal pengiriman).</div>
        </> : "Isi qty retur yang tidak melebihi sisa per baris."}
        <div style={{ fontSize: 11, marginTop: 4 }}>Kredit pelanggan dicatat sebagai kewajiban (akun 314001) — tidak ada uang keluar otomatis. Angka akhir dihitung ulang server.</div>
      </div>
      <label className="flab" htmlFor="retur-alasan">Alasan retur (wajib)</label>
      <input className="fi" id="retur-alasan" name="alasan" required minLength={3} maxLength={1000} />
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <SubmitButton className="btn-acc" name="tindakan" value="simpan" disabled={!ready || !hasil.valid || (butuhGudang && !warehouse)} pendingText="Menyimpan…">Simpan retur</SubmitButton>
        <button className="btn-def" type="submit" name="tindakan" value="periksa" formNoValidate disabled={!ready}>Periksa hasil terakhir</button>
      </div>
    </>}
  </CorrectionTransactionForm>;
}
