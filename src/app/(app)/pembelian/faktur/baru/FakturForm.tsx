"use client";

import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { buatFaktur } from "../actions";

export type PoOption = {
  id: string;
  label: string;
  items: { item_id: string; nama: string; harga_po: number; sisa: number }[];
};

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const plusDays = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export function FakturForm({ options }: { options: PoOption[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [poId, setPoId] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [harga, setHarga] = useState<Record<string, number>>({});

  const po = options.find((o) => o.id === poId);

  const pilihPo = (id: string) => {
    setPoId(id);
    const o = options.find((x) => x.id === id);
    // default: fakturkan semua sisa dengan harga PO — edit yang beda dari faktur pemasok.
    setQty(Object.fromEntries((o?.items ?? []).map((it) => [it.item_id, it.sisa])));
    setHarga(Object.fromEntries((o?.items ?? []).map((it) => [it.item_id, it.harga_po])));
  };

  const payload = (po?.items ?? [])
    .map((it) => ({
      item_id: it.item_id,
      qty: Number(qty[it.item_id]) || 0,
      harga: Number(harga[it.item_id]) || 0,
    }))
    .filter((r) => r.qty > 0);
  const total = payload.reduce((a, r) => a + r.qty * r.harga, 0);

  return (
    <form action={buatFaktur}>
      <input type="hidden" name="po_id" value={poId} />
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      <div className="grid2">
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="01" title="DATA FAKTUR" desc="PO sumber, nomor faktur pemasok, tanggal & jatuh tempo." />
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">PO / Pemasok *</label>
            <select className="fi" value={poId} onChange={(e) => pilihPo(e.target.value)} required>
              <option value="">Pilih PO (Diterima)</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">No. faktur pemasok</label>
            <input className="fi" name="no_faktur_pemasok" placeholder="Nomor di kertas faktur dari pemasok" />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div className="fg" style={{ marginBottom: 10, flex: 1 }}>
              <label className="flab">Tanggal faktur *</label>
              <input className="fi" type="date" name="tanggal" defaultValue={today} required />
            </div>
            <div className="fg" style={{ marginBottom: 10, flex: 1 }}>
              <label className="flab">Jatuh tempo *</label>
              <input className="fi" type="date" name="jatuh_tempo" defaultValue={plusDays(today, 30)} required />
            </div>
          </div>
          <div className="fg">
            <label className="flab">Keterangan</label>
            <textarea className="fi" name="keterangan" rows={2} placeholder="Opsional..." style={{ resize: "vertical" }} />
          </div>
        </div>

        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="02" title="RINCIAN TAGIHAN" desc="Terisi dari PO — ubah qty/harga sesuai faktur pemasok bila beda." />
          {!po && <div style={{ fontSize: 11, color: "var(--td)", padding: "12px 0" }}>Pilih PO dulu.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(po?.items ?? []).map((it) => {
              const beda = (Number(harga[it.item_id]) || 0) !== it.harga_po;
              return (
                <div key={it.item_id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ flex: 1, fontSize: 11.5 }}>
                    {it.nama}{" "}
                    <span style={{ color: "var(--td)", fontSize: 10.5 }}>PO @{rp(it.harga_po)} · maks {it.sisa}</span>
                  </span>
                  <input className="fi" type="number" min={0} max={it.sisa} step="any"
                    value={qty[it.item_id] ?? 0}
                    onChange={(e) => setQty((m) => ({ ...m, [it.item_id]: Number(e.target.value) }))}
                    style={{ width: 74 }} title="Qty faktur" />
                  <input className="fi" type="number" min={0} step="any"
                    value={harga[it.item_id] ?? 0}
                    onChange={(e) => setHarga((m) => ({ ...m, [it.item_id]: Number(e.target.value) }))}
                    style={{ width: 110, borderColor: beda ? "#f59e0b" : undefined }} title="Harga faktur / unit" />
                </div>
              );
            })}
          </div>
          {po && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10, fontSize: 12, fontWeight: 700 }}>
              Total faktur: {rp(total)}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button type="submit" className="btn-acc" disabled={!poId || payload.length === 0}>
          <i className="ti ti-file-invoice" /> Simpan faktur
        </button>
      </div>
    </form>
  );
}
