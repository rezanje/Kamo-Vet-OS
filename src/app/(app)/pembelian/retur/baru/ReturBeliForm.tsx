"use client";

import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { buatReturBeli } from "../actions";

export type PoOption = {
  id: string;
  label: string;
  items: { item_id: string; nama: string; harga: number; sisa: number }[];
};

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export function ReturBeliForm({ options }: { options: PoOption[] }) {
  const [poId, setPoId] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});

  const po = options.find((o) => o.id === poId);
  const payload = (po?.items ?? [])
    .map((it) => ({ item_id: it.item_id, qty: Number(qty[it.item_id]) || 0 }))
    .filter((r) => r.qty > 0);
  const total = (po?.items ?? []).reduce(
    (a, it) => a + (Number(qty[it.item_id]) || 0) * it.harga, 0);

  return (
    <form action={buatReturBeli}>
      <input type="hidden" name="po_id" value={poId} />
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      <div className="grid2">
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="01" title="SUMBER RETUR" desc="Pilih PO (status Diterima) yang barangnya dikembalikan." />
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">PO / Pemasok *</label>
            <select className="fi" value={poId} onChange={(e) => { setPoId(e.target.value); setQty({}); }} required>
              <option value="">Pilih PO</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Tanggal *</label>
            <input className="fi" type="date" name="tanggal" defaultValue={new Date().toISOString().slice(0, 10)} required />
          </div>
          <div className="fg">
            <label className="flab">Keterangan</label>
            <textarea className="fi" name="keterangan" rows={3}
              placeholder="Alasan retur (opsional)..." style={{ resize: "vertical" }} />
          </div>
        </div>

        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="02" title="RINCIAN BARANG" desc="Isi qty yang diretur (maks sisa yang bisa diretur)." />
          {!po && (
            <div style={{ fontSize: 11, color: "var(--td)", padding: "12px 0" }}>Pilih PO dulu.</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(po?.items ?? []).map((it) => (
              <div key={it.item_id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ flex: 1, fontSize: 11.5 }}>
                  {it.nama} <span style={{ color: "var(--td)", fontSize: 10.5 }}>@{rp(it.harga)}</span>
                </span>
                <span style={{ fontSize: 10.5, color: "var(--tm)" }}>maks {it.sisa}</span>
                <input className="fi" type="number" min={0} max={it.sisa} step="any"
                  value={qty[it.item_id] ?? 0}
                  onChange={(e) => setQty((q) => ({ ...q, [it.item_id]: Number(e.target.value) }))}
                  style={{ width: 90 }} title="Qty retur" />
              </div>
            ))}
          </div>
          {po && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10, fontSize: 12, fontWeight: 700 }}>
              Total retur: {rp(total)}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button type="submit" className="btn-acc" disabled={!poId || payload.length === 0}>
          <i className="ti ti-truck-return" /> Simpan retur
        </button>
      </div>
    </form>
  );
}
