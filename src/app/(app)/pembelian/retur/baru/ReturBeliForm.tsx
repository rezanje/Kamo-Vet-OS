"use client";

import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { buatReturBeli } from "../actions";
import { type ReturnFormRow } from "@/lib/return-source-units";
import { usePreservedAction } from "@/components/LocalTransactionDraft";
import { draftRecord, draftNumber, draftString } from "@/components/TransactionDraft";
import { PostingRequestIdentity } from "@/components/PostingRequestIdentity";
import { hariIniWIB } from "@/lib/tanggal";

export type PoOption = {
  id: string;
  label: string;
  items: ReturnFormRow[];
};

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export function ReturBeliForm({ options, userId, confirmedScope, confirmedKey }: { confirmedScope?:string; confirmedKey?:string; options: PoOption[]; userId?: string }) {
  const {save,failure}=usePreservedAction(buatReturBeli);
  const [poId, setPoId] = useState("");
  const [unit, setUnit] = useState<Record<string, string>>({});
  const chosen = (r: ReturnFormRow) => r.units.find(u => u.unit === unit[r.source_line_id]) ?? r.units[0];
  const [qty, setQty] = useState<Record<string, number>>({});

  const po = options.find((o) => o.id === poId);
  const payload = (po?.items ?? [])
    .map((it) => ({ item_id: it.item_id, source_line_id: it.source_line_id, satuan: chosen(it)?.unit, qty: Number(qty[it.source_line_id]) || 0 }))
    .filter((r) => r.qty > 0);
  const total = (po?.items ?? []).reduce(
    (a, it) => a + (Number(qty[it.source_line_id]) || 0) * (chosen(it)?.factor ?? 1) * it.harga, 0);

  return (
    <form action={save}>
      {failure && <div role="alert" className="p2ban">{failure}</div>}
      <PostingRequestIdentity scope="purchase-return" userId={userId} confirmedScope={confirmedScope} confirmedKey={confirmedKey} state={{snapshot:{poId,qty,unit},reset:()=>{setPoId("");setQty({});setUnit({});},restore:value=>{
        if(typeof value.poId!=="string"||!draftRecord(value.qty,draftNumber)||!draftRecord(value.unit,draftString))return false;
        setPoId(value.poId);setQty(value.qty);setUnit(value.unit);return true;
      }}} />
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
            <input className="fi" type="date" name="tanggal" defaultValue={hariIniWIB()} required />
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
              <div key={it.source_line_id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ flex: 1, fontSize: 11.5 }}>
                  {it.nama} <small style={{color:"var(--td)"}}>({it.source_qty} {it.source_unit})</small> <span style={{ color: "var(--td)", fontSize: 10.5 }}>@{rp(it.harga * (chosen(it)?.factor ?? 1))}</span>
                </span>
                <span style={{ fontSize: 10.5, color: "var(--tm)" }}>maks {it.sisa / (chosen(it)?.factor ?? 1)} {chosen(it)?.unit}</span>
                <select className="fi" title="Satuan retur" value={chosen(it)?.unit ?? ""} onChange={e => setUnit(u => ({...u, [it.source_line_id]: e.target.value}))}>
                  {it.units.map(u => <option key={u.unit} value={u.unit}>{u.unit}</option>)}
                </select>
                <input className="fi" type="number" min={0} max={it.sisa / (chosen(it)?.factor ?? 1)} step="any"
                  value={qty[it.source_line_id] ?? 0}
                  onChange={(e) => setQty((q) => ({ ...q, [it.source_line_id]: Number(e.target.value) }))}
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
