"use client";

import { useRef, useState } from "react";
import { terimaBarang } from "../../actions";
import { receiptSummary } from "@/lib/stock-recon";

type ItemIn = { id: string; item_id: string | null; nama: string; qty_diminta: number; catatan?: string | null };
type Row = ItemIn & { qty_diterima: number; kondisi: string; notes: string };
export type CatalogItem = { id: string; name: string; upc: string | null };

const KONDISI = [
  { v: "baik", label: "Baik" },
  { v: "rusak", label: "Rusak" },
  { v: "kurang", label: "Kurang" },
];

// Penerimaan barang (Addendum §5, design petshop/07): dipesan vs diterima side-by-side,
// kondisi per item, ringkasan footer, scan barcode utk auto-isi qty.
export function TerimaForm({ requestId, items, catalog }: { requestId: string; items: ItemIn[]; catalog: CatalogItem[] }) {
  const [rows, setRows] = useState<Row[]>(
    items.map((it) => ({ ...it, qty_diterima: Number(it.qty_diminta) || 0, kondisi: "baik", notes: "" }))
  );
  const [barcode, setBarcode] = useState("");
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // scan barcode → lookup items.upc → auto-tambah qty diterima baris yang cocok (§5).
  const onScan = () => {
    const code = barcode.trim();
    if (!code) return;
    const item = catalog.find((c) => c.upc && c.upc === code);
    const idx = item
      ? rows.findIndex((r) => r.item_id === item.id || r.nama.toLowerCase() === item.name.toLowerCase())
      : -1;
    if (idx >= 0) {
      set(idx, { qty_diterima: rows[idx].qty_diterima + 1 });
      setScanMsg(`+1 ${rows[idx].nama}`);
    } else {
      setScanMsg(item ? `"${item.name}" tidak ada di permintaan ini` : `Barcode ${code} tidak dikenal`);
    }
    setBarcode("");
    barcodeRef.current?.focus();
  };

  const payload = rows.map((r) => ({
    id: r.id, item_id: r.item_id, nama: r.nama, qty_diminta: r.qty_diminta,
    qty_diterima: r.qty_diterima, kondisi: r.kondisi, notes: r.notes,
  }));
  const summary = receiptSummary(rows.map((r) => ({ qty_ordered: Number(r.qty_diminta) || 0, qty_received: Number(r.qty_diterima) || 0 })));

  return (
    <form action={terimaBarang}>
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      {/* Scan barcode (§5) */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <div style={{ position: "relative", width: 280 }}>
          <input
            ref={barcodeRef} className="fi" placeholder="Scan / ketik barcode lalu Enter..."
            value={barcode} onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onScan(); } }}
          />
          <i className="ti ti-barcode" style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--td)" }} />
        </div>
        {scanMsg && <span style={{ fontSize: 10.5, color: scanMsg.startsWith("+1") ? "#15803d" : "#b91c1c" }}>{scanMsg}</span>}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th>Nama Barang</th>
              <th style={{ textAlign: "center" }}>Dipesan</th>
              <th style={{ textAlign: "center" }}>Diterima</th>
              <th style={{ textAlign: "center" }}>Selisih</th>
              <th>Kondisi</th>
              <th>Keterangan</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const selisih = Math.round(((Number(r.qty_diterima) || 0) - (Number(r.qty_diminta) || 0)) * 100) / 100;
              return (
                <tr key={r.id}>
                  <td style={{ fontSize: 11.5 }}>
                    {r.nama}
                    {r.catatan && <div style={{ fontSize: 9.5, color: "var(--td)" }}>catatan: {r.catatan}</div>}
                  </td>
                  <td style={{ textAlign: "center", fontSize: 11.5, color: "var(--tm)" }}>{r.qty_diminta}</td>
                  <td style={{ textAlign: "center" }}>
                    <input
                      className="fi" type="number" min={0} step="any" value={r.qty_diterima}
                      onChange={(e) => set(i, { qty_diterima: Number(e.target.value) })}
                      style={{ width: 90, textAlign: "center" }}
                    />
                  </td>
                  <td style={{ textAlign: "center", fontSize: 11.5, fontWeight: selisih === 0 ? 400 : 700, color: selisih === 0 ? "var(--tm)" : "#b91c1c" }}>
                    {selisih === 0 ? "0" : `Selisih: ${selisih > 0 ? "+" : ""}${selisih}`}
                  </td>
                  <td>
                    <select className="fi" value={r.kondisi} onChange={(e) => set(i, { kondisi: e.target.value })} style={{ width: 100 }}>
                      {KONDISI.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <input className="fi" value={r.notes} placeholder="mis. 2 karung sobek"
                      onChange={(e) => set(i, { notes: e.target.value })} style={{ minWidth: 140 }} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>
                  Tidak ada item pada permintaan ini.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "1.5px solid var(--bd)", fontWeight: 700 }}>
              <td style={{ fontSize: 11.5 }}>TOTAL</td>
              <td style={{ textAlign: "center", fontSize: 11.5 }}>{summary.ordered}</td>
              <td style={{ textAlign: "center", fontSize: 11.5 }}>{summary.received}</td>
              <td style={{ textAlign: "center", fontSize: 11.5, color: summary.selisih === 0 ? "#15803d" : "#b91c1c" }}>
                {summary.selisih > 0 ? "+" : ""}{summary.selisih}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
        <span style={{ fontSize: 9.5, color: "var(--td)" }}>
          Stok cabang bertambah sesuai QTY DITERIMA (bukan dipesan) — selisih tercatat di dokumen TRM.
        </span>
        <button type="submit" className="btn-acc" disabled={rows.length === 0}>
          <i className="ti ti-circle-check" /> Konfirmasi Penerimaan
        </button>
      </div>
    </form>
  );
}
