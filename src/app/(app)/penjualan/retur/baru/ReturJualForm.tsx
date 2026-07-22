"use client";

import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { buatReturJual } from "../actions";

type Row = { item_id: string; nama: string; harga: number; sisa: number };

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export function ReturJualForm({ saleId, info, rows }: { saleId: string; info: string; rows: Row[] }) {
  const [qty, setQty] = useState<Record<string, number>>({});

  const payload = rows
    .map((r) => ({ item_id: r.item_id, qty: Number(qty[r.item_id]) || 0 }))
    .filter((r) => r.qty > 0);
  const total = rows.reduce((a, r) => a + (Number(qty[r.item_id]) || 0) * r.harga, 0);

  return (
    <form action={buatReturJual}>
      <input type="hidden" name="sale_id" value={saleId} />
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      <div className="crm-sec">
        <SecHeader num="02" title="RINCIAN BARANG" desc={`Struk ${info}. Isi qty yang dikembalikan.`} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(160px, 220px))", gap: 10, marginBottom: 10 }}>
          <div className="fg">
            <label className="flab">Tanggal retur *</label>
            <input className="fi" type="date" name="tanggal" defaultValue={new Date().toISOString().slice(0, 10)} required />
          </div>
          <div className="fg">
            <label className="flab">Keterangan</label>
            <input className="fi" name="keterangan" placeholder="Alasan retur (opsional)" />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => (
            <div key={r.item_id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ flex: 1, fontSize: 11.5 }}>
                {r.nama} <span style={{ color: "var(--td)", fontSize: 10.5 }}>@{rp(r.harga)}</span>
              </span>
              <span style={{ fontSize: 10.5, color: "var(--tm)" }}>maks {r.sisa}</span>
              <input className="fi" type="number" min={0} max={r.sisa} step="any"
                value={qty[r.item_id] ?? 0}
                onChange={(e) => setQty((q) => ({ ...q, [r.item_id]: Number(e.target.value) }))}
                style={{ width: 90 }} title="Qty retur" />
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
          <span style={{ fontSize: 10.5, color: "var(--tm)" }}>
            Refund tunai dicatat sebagai pengeluaran kasir (kategori Retur Penjualan).
          </span>
          <span style={{ fontSize: 12, fontWeight: 700 }}>Total refund: {rp(total)}</span>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button type="submit" className="btn-acc" disabled={payload.length === 0}>
            <i className="ti ti-receipt-refund" /> Simpan retur & refund
          </button>
        </div>
      </div>
    </form>
  );
}
