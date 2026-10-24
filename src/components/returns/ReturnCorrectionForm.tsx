"use client";

import { NumberInput } from "@/components/NumberInput";

import { useState } from "react";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { correctReturn } from "@/app/(app)/penjualan/retur/corrections";

export type CorrectionReturnLine = {
  id: string; source_line_id: string; item_id: string; nama: string;
  selected_qty: number; satuan: string; qty?: number; kondisi?: string; exp_date?: string | null;
};

export function ReturnCorrectionForm({ userId, kind, id, revision, rows }: {
  userId: string; kind: "sales" | "purchase"; id: string; revision: number; rows: CorrectionReturnLine[];
}) {
  const [cancel, setCancel] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const items = cancel ? [] : rows.map(row => ({
    source_line_id: row.source_line_id, item_id: row.item_id, satuan: row.satuan,
    qty: Number(quantities[row.id] ?? row.selected_qty), kondisi: row.kondisi ?? "baik", exp_date: row.exp_date,
  })).filter(row => row.qty > 0);
  return <CorrectionTransactionForm userId={userId} scope={`return-correct:${kind}:${id}:${revision}`} action={correctReturn}
    state={{ snapshot: { cancel, quantities }, reset: () => { setCancel(false); setQuantities({}); }, restore: saved => {
      if (typeof saved.cancel !== "boolean" || !saved.quantities || typeof saved.quantities !== "object" || Array.isArray(saved.quantities)
        || Object.entries(saved.quantities).some(([key, value]) => !rows.some(row => row.id === key) || typeof value !== "string")) return false;
      setCancel(saved.cancel); setQuantities(saved.quantities as Record<string, string>); return true;
    } }}>
    {({ ready }) => <>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <p>Koreksi jumlah catatan sesuai bukti fisik. Barang harus sudah {kind === "sales" ? "diterima dari pelanggan" : "dikirim ke pemasok"}. Simpan tidak melakukan pengiriman, refund, atau transfer bank.</p>
      <label className="flab"><input type="checkbox" checked={cancel} onChange={event => setCancel(event.target.checked)} /> Batalkan seluruh catatan: bukti mengonfirmasi tidak ada barang yang diretur</label>
      {!cancel && rows.map(row => <div className="fg" key={row.id}>
        <label className="flab" htmlFor={`return-qty-${row.id}`}>{row.nama} — jumlah fisik terkonfirmasi ({row.satuan}), tercatat {Number(row.selected_qty)}</label>
        <NumberInput id={`return-qty-${row.id}`} className="fi" type="number" min="0" step="any" required
          value={quantities[row.id] ?? row.selected_qty} onChange={event => setQuantities(current => ({ ...current, [row.id]: event.target.value }))} />
        {row.kondisi && <small>Kondisi: {row.kondisi}{row.exp_date ? ` · Kadaluarsa: ${row.exp_date}` : ""}</small>}
      </div>)}
      <div className="fg"><label className="flab" htmlFor="return-reason">Alasan koreksi *</label>
        <textarea id="return-reason" className="fi" name="reason" required minLength={3} maxLength={1000} /></div>
      <div className="fg"><label className="flab" htmlFor="return-evidence">Bukti penerimaan/pengiriman aktual *</label>
        <textarea id="return-evidence" className="fi" name="physical_evidence" required minLength={10} maxLength={2000}
          placeholder="Nomor bukti, tanggal, pemeriksa, dan hasil hitung aktual. Jika batal, jelaskan bukti bahwa barang tidak pernah diterima/dikirim atau telah kembali." /></div>
      <label className="flab"><input type="checkbox" name="physical_checked" value="yes" required /> Saya telah memeriksa bukti dan jumlah fisik di atas.</label>
      <p>Dokumen dan jurnal asal tetap disimpan. Efek lama dibalik dan catatan pengganti ditautkan; dependensi yang tidak aman akan memblokir koreksi.</p>
      <button className="btn-acc" disabled={!ready || (!cancel && items.length === 0)} type="submit">{cancel ? "Batalkan catatan retur" : "Simpan koreksi dan pengganti"}</button>
    </>}
  </CorrectionTransactionForm>;
}
