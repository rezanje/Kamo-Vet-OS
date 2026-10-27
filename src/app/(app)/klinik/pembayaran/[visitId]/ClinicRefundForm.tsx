"use client";

import { useState } from "react";
import { NumberInput } from "@/components/NumberInput";
import { SubmitButton } from "@/components/SubmitButton";
import { usePreservedAction } from "@/components/LocalTransactionDraft";
import { PostingRequestIdentity } from "@/components/PostingRequestIdentity";
import { draftRecord, draftNumber, draftString } from "@/components/TransactionDraft";
import { formatPosMoney, PosDecimal } from "@/lib/pos-money";
import { hariIniWIB } from "@/lib/tanggal";
import { buatRefundKlinik, periksaRefundKlinik } from "./refund-actions";

export type ClinicRefundRow = {
  id: string; deskripsi: string; satuan: string | null; qty: number; sisa: number;
  /** Obat utuh dari stok: boleh kembali ke stok bila layak jual. Jasa/tindakan/racikan: uang saja. */
  restock: boolean;
  /** Nilai per unit setelah diskon baris, diskon invoice dan PPN (perkiraan; server menghitung final). */
  nilaiUnit: number;
};

const rp = formatPosMoney;

export function ClinicRefundForm({ visitId, invoiceId, rows, userId }: { visitId: string; invoiceId: string; rows: ClinicRefundRow[]; userId?: string }) {
  const { save, failure } = usePreservedAction(buatRefundKlinik);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [kondisi, setKondisi] = useState<Record<string, string>>({});
  const [exp, setExp] = useState<Record<string, string>>({});
  const [method, setMethod] = useState("");
  const [destination, setDestination] = useState({ bank: "", account: "", name: "" });

  const payload = rows
    .map((r) => ({
      invoice_item_id: r.id,
      qty: Math.trunc(Number(qty[r.id]) || 0),
      ...(r.restock ? { kondisi: kondisi[r.id] ?? "baik", ...(exp[r.id] && (kondisi[r.id] ?? "baik") === "baik" ? { exp_date: exp[r.id] } : {}) } : {}),
    }))
    .filter((r) => r.qty > 0);
  const total = rows.reduce((sum, r) => sum.plus(new PosDecimal(Math.trunc(Number(qty[r.id]) || 0)).times(r.nilaiUnit)), new PosDecimal(0)).toDecimalPlaces(2).toNumber();

  return (
    <form action={save}>
      {failure && <div role="alert" className="p2ban">{failure}</div>}
      <PostingRequestIdentity scope={`clinic-refund:${invoiceId}`} userId={userId} recoverAction={periksaRefundKlinik} state={{
        snapshot: { qty, kondisi, exp, method, destination },
        reset: () => { setQty({}); setKondisi({}); setExp({}); setMethod(""); setDestination({ bank: "", account: "", name: "" }); },
        restore: (value) => {
          if (!draftRecord(value.qty, draftNumber) || !draftRecord(value.kondisi, draftString) || !draftRecord(value.exp, draftString)) return false;
          if (value.method !== undefined && !["", "Tunai", "Transfer"].includes(String(value.method))) return false;
          if (value.destination !== undefined && (!draftRecord(value.destination, draftString)
            || !["bank", "account", "name"].every((k) => typeof (value.destination as Record<string, string>)[k] === "string" && (value.destination as Record<string, string>)[k].length <= 120))) return false;
          setQty(value.qty); setKondisi(value.kondisi); setExp(value.exp); setMethod(String(value.method ?? ""));
          setDestination((value.destination ?? { bank: "", account: "", name: "" }) as typeof destination);
          return true;
        },
      }} />
      <input type="hidden" name="visit_id" value={visitId} />
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <label className="fg" style={{ flex: "0 1 170px" }}><span className="flab">Tanggal refund *</span>
          <input className="fi" type="date" name="tanggal" defaultValue={hariIniWIB()} max={hariIniWIB()} required /></label>
        <label className="fg" style={{ flex: "1 1 220px" }}><span className="flab">Alasan</span>
          <input className="fi" name="keterangan" maxLength={500} placeholder="Alasan refund (opsional)" /></label>
        <label className="fg" style={{ flex: "1 1 240px" }}><span className="flab">Cara pengembalian uang *</span>
          <select className="fi" name="refund_method" required value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">Pilih</option>
            <option value="Tunai">Tunai dari kas shift klinik</option>
            <option value="Transfer">Transfer melalui finance</option>
          </select></label>
      </div>
      {method === "Tunai" && <p style={{ fontSize: 10.5 }}>Uang keluar dari kas shift klinik Anda yang sedang buka, apa pun cara bayar asalnya.</p>}
      {method === "Transfer" && <>
        <p style={{ fontSize: 10.5 }}>Permintaan masuk antrean finance. Jurnal dan stok baru diposting saat finance mencatat transfer selesai. Jangan bayar tunai untuk permintaan yang sama.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <label style={{ flex: "1 1 160px" }}><span className="flab">Bank tujuan *</span><input className="fi" name="refund_bank" required maxLength={80} value={destination.bank} onChange={(e) => setDestination((d) => ({ ...d, bank: e.target.value }))} /></label>
          <label style={{ flex: "1 1 160px" }}><span className="flab">Nomor rekening *</span><input className="fi" name="refund_account" required maxLength={40} value={destination.account} onChange={(e) => setDestination((d) => ({ ...d, account: e.target.value }))} /></label>
          <label style={{ flex: "1 1 160px" }}><span className="flab">Nama penerima *</span><input className="fi" name="refund_name" required maxLength={120} value={destination.name} onChange={(e) => setDestination((d) => ({ ...d, name: e.target.value }))} /></label>
        </div>
      </>}

      <table className="tbl" style={{ marginTop: 10 }}>
        <thead><tr><th>Item</th><th style={{ textAlign: "center" }}>Sisa</th><th style={{ textAlign: "center" }}>Qty refund</th><th>Barang kembali</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const dipilih = (Number(qty[r.id]) || 0) > 0;
            const kond = kondisi[r.id] ?? "baik";
            return (
              <tr key={r.id}>
                <td>{r.deskripsi} <small style={{ color: "var(--td)" }}>@{rp(r.nilaiUnit)}{r.satuan ? ` / ${r.satuan}` : ""}</small></td>
                <td style={{ textAlign: "center" }}>{r.sisa} / {r.qty}</td>
                <td style={{ textAlign: "center" }}>
                  <NumberInput className="fi" type="number" min={0} max={r.sisa} step={1} disabled={r.sisa <= 0} title={`Qty refund ${r.deskripsi}`}
                    value={qty[r.id] ?? 0} onChange={(e) => setQty((q) => ({ ...q, [r.id]: Number(e.target.value) }))} style={{ width: 80 }} />
                </td>
                <td>
                  {!r.restock ? <small>Uang saja (jasa/tindakan/racikan)</small> : dipilih ? <>
                    <select className="fi" title="Kondisi obat" value={kond} onChange={(e) => setKondisi((k) => ({ ...k, [r.id]: e.target.value }))}>
                      <option value="baik">Layak jual — kembali ke stok</option>
                      <option value="rusak">Tidak layak jual</option>
                    </select>
                    {kond === "baik" && <input className="fi" type="date" title="Tanggal kadaluarsa obat yang kembali" value={exp[r.id] ?? ""}
                      onChange={(e) => setExp((x) => ({ ...x, [r.id]: e.target.value }))} style={{ marginTop: 4 }} />}
                  </> : <small>—</small>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <small style={{ color: "var(--tm)" }}>Tanpa biaya admin. Poin yang didapat dari invoice ini dikurangi sebanding nilai refund. Nilai final dihitung ulang dari invoice asal.</small>
        <strong>Perkiraan refund: {rp(total)}</strong>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
        <SubmitButton className="btn-acc" pendingText="Memproses…" disabled={payload.length === 0 || !method}>
          {method === "Transfer" ? "Ajukan refund transfer" : "Simpan refund tunai"}
        </SubmitButton>
      </div>
    </form>
  );
}
