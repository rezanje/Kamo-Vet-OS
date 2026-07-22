"use client";

import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { terimaBarang } from "../actions";

type Row = { item_id: string; name: string; code: string; unit: string; sisa: number };

export function TerimaForm({ sourceTransferId, rows }: { sourceTransferId: string; rows: Row[] }) {
  // default: terima semua sisa
  const [qty, setQty] = useState<Record<string, number>>(
    Object.fromEntries(rows.map((r) => [r.item_id, r.sisa])),
  );

  const payload = rows
    .map((r) => ({ item_id: r.item_id, qty: Number(qty[r.item_id]) || 0 }))
    .filter((r) => r.qty > 0);

  return (
    <form action={terimaBarang}>
      <input type="hidden" name="source_transfer_id" value={sourceTransferId} />
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      <div className="crm-sec">
        <SecHeader num="03" title="TERIMA BARANG" desc="Konfirmasi barang sampai di gudang tujuan. Qty bisa dikurangi bila diterima sebagian." />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(160px, 220px))", gap: 10, marginBottom: 10 }}>
          <div className="fg">
            <label className="flab">Tanggal terima *</label>
            <input className="fi" type="date" name="tanggal" defaultValue={new Date().toISOString().slice(0, 10)} required />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => (
            <div key={r.item_id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ flex: 1, fontSize: 11.5 }}>
                {r.name} <span style={{ color: "var(--td)", fontSize: 10.5 }}>({r.code})</span>
              </span>
              <span style={{ fontSize: 10.5, color: "var(--tm)" }}>sisa {r.sisa}</span>
              <input className="fi" type="number" min={0} max={r.sisa} step="any"
                value={qty[r.item_id] ?? 0}
                onChange={(e) => setQty((q) => ({ ...q, [r.item_id]: Number(e.target.value) }))}
                style={{ width: 90 }} title="Qty diterima" />
              <span style={{ fontSize: 10.5, color: "var(--tm)", width: 34 }}>{r.unit}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button type="submit" className="btn-acc" disabled={payload.length === 0}>
            <i className="ti ti-package-import" /> Terima barang
          </button>
        </div>
      </div>
    </form>
  );
}
