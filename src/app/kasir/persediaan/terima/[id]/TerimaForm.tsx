"use client";

import { useState } from "react";
import { terimaBarang } from "../../actions";

type ItemIn = { id: string; item_id: string | null; nama: string; qty_diminta: number };
type Row = ItemIn & { qty_diterima: number; kondisi: string };

const KONDISI = ["Baik", "Rusak", "Kurang"];

export function TerimaForm({ requestId, items }: { requestId: string; items: ItemIn[] }) {
  const [rows, setRows] = useState<Row[]>(
    items.map((it) => ({ ...it, qty_diterima: Number(it.qty_diminta) || 0, kondisi: "Baik" }))
  );

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const payload = rows.map((r) => ({
    id: r.id,
    item_id: r.item_id,
    qty_diterima: r.qty_diterima,
    kondisi: r.kondisi,
  }));

  return (
    <form action={terimaBarang}>
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>Nama Barang</th>
              <th style={{ textAlign: "center" }}>Qty Diminta</th>
              <th style={{ textAlign: "center" }}>Qty Diterima</th>
              <th style={{ textAlign: "center" }}>Selisih</th>
              <th>Kondisi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const selisih = (Number(r.qty_diminta) || 0) - (Number(r.qty_diterima) || 0);
              return (
                <tr key={r.id}>
                  <td style={{ fontSize: 11.5 }}>{r.nama}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5, color: "var(--tm)" }}>{r.qty_diminta}</td>
                  <td style={{ textAlign: "center" }}>
                    <input
                      className="fi"
                      type="number"
                      min={0}
                      step="any"
                      value={r.qty_diterima}
                      onChange={(e) => set(i, { qty_diterima: Number(e.target.value) })}
                      style={{ width: 90, textAlign: "center" }}
                    />
                  </td>
                  <td style={{ textAlign: "center", fontSize: 11.5, color: selisih === 0 ? "var(--tm)" : "#b91c1c", fontWeight: selisih === 0 ? 400 : 600 }}>
                    {selisih}
                  </td>
                  <td>
                    <select
                      className="fi"
                      value={r.kondisi}
                      onChange={(e) => set(i, { kondisi: e.target.value })}
                      style={{ width: 110 }}
                    >
                      {KONDISI.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>
                  Tidak ada item pada permintaan ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button type="submit" className="btn-acc" disabled={rows.length === 0}>
          <i className="ti ti-circle-check" /> Konfirmasi Penerimaan
        </button>
      </div>
    </form>
  );
}
