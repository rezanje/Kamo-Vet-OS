"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { terimaBarang } from "../../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { receiptSummary } from "@/lib/stock-recon";

type ItemIn = { id: string; item_id: string | null; nama: string; qty_diminta: number; catatan?: string | null };
type Row = ItemIn & { qty_diterima: number; kondisi: string; notes: string };
export type CatalogItem = { id: string; code: string; name: string; unit: string; upc: string | null; kategori: string };

const KONDISI = [
  { v: "baik", label: "Baik" },
  { v: "rusak", label: "Rusak" },
  { v: "kurang", label: "Kurang" },
];

const today = "2026-07-01";

// Penerimaan barang (Addendum §5, mockup petshop): dipesan vs diterima, kondisi per item,
// ringkasan footer, scan barcode auto-isi qty. Layout mengikuti mockup PENERIMAAN BARANG.
export function TerimaForm({
  requestId, noRequest, whName, userName, items, catalog, action = terimaBarang, backHref = "/kasir/persediaan?tab=penerimaan",
}: {
  requestId: string; noRequest: string; whName: string; userName: string;
  items: ItemIn[]; catalog: CatalogItem[];
  action?: (formData: FormData) => void | Promise<void>; backHref?: string;
}) {
  const [rows, setRows] = useState<Row[]>(
    items.map((it) => ({ ...it, qty_diterima: Number(it.qty_diminta) || 0, kondisi: "baik", notes: "" }))
  );
  const [barcode, setBarcode] = useState("");
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const catMap = useMemo(() => Object.fromEntries(catalog.map((c) => [c.id, c])), [catalog]);

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const del = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

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
    <form action={action}>
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      {/* Header halaman */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: "var(--posb)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <i className="ti ti-package-import" style={{ fontSize: 22, color: "#fff" }} />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--posb)", letterSpacing: ".01em" }}>PENERIMAAN BARANG</div>
            <div style={{ fontSize: 11.5, color: "var(--tm)", marginTop: 1 }}>Catat barang yang diterima dari gudang / supplier</div>
          </div>
        </div>
        <Link href={backHref} className="btn-def" style={{ display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none" }}>
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
      </div>

      {/* INFORMASI PENERIMAAN */}
      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--posb)", marginBottom: 12, letterSpacing: ".03em" }}>INFORMASI PENERIMAAN</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <div>
            <label className="flab">Tanggal Terima</label>
            <input className="fi" type="date" defaultValue={today} disabled style={{ background: "var(--sf1)", color: "var(--tm)" }} />
          </div>
          <div>
            <label className="flab">No. Penerimaan</label>
            <input className="fi" value="Otomatis (TRM-…)" disabled style={{ background: "var(--sf1)", color: "var(--tm)" }} />
          </div>
          <div>
            <label className="flab">Dari (Gudang / Supplier)</label>
            <input className="fi" value={whName} disabled style={{ background: "var(--sf1)", color: "var(--tm)" }} />
          </div>
          <div>
            <label className="flab">Referensi</label>
            <input className="fi" value={noRequest} disabled style={{ background: "var(--sf1)", color: "var(--tm)" }} />
          </div>
          <div>
            <label className="flab">Diterima Oleh</label>
            <input className="fi" value={userName} disabled style={{ background: "var(--sf1)", color: "var(--tm)" }} />
          </div>
          <div>
            <label className="flab">Catatan (Opsional)</label>
            <input className="fi" name="catatan" type="text" placeholder="Contoh: Penerimaan sesuai permintaan" />
          </div>
        </div>
      </div>

      {/* DAFTAR BARANG DITERIMA */}
      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--posb)", letterSpacing: ".03em" }}>DAFTAR BARANG DITERIMA</div>
          {/* Scan barcode (§5): ketik/scan lalu Enter → +1 qty diterima baris cocok. */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {scanMsg && <span style={{ fontSize: 10.5, color: scanMsg.startsWith("+1") ? "#15803d" : "#b91c1c" }}>{scanMsg}</span>}
            <div style={{ position: "relative", width: 260 }}>
              <input
                ref={barcodeRef} className="fi" placeholder="Scan / ketik barcode lalu Enter..."
                value={barcode} onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onScan(); } }}
                style={{ paddingRight: 26 }}
              />
              <i className="ti ti-barcode" style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--td)" }} />
            </div>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ width: 34 }}>No.</th>
                <th>Kode</th><th>Nama Barang</th><th>Kategori</th><th>Satuan</th>
                <th style={{ textAlign: "center" }}>Dipesan</th>
                <th style={{ textAlign: "center", width: 130 }}>Diterima</th>
                <th style={{ textAlign: "center" }}>Selisih</th>
                <th>Kondisi</th><th>Keterangan</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const c = r.item_id ? catMap[r.item_id] : undefined;
                const selisih = Math.round(((Number(r.qty_diterima) || 0) - (Number(r.qty_diminta) || 0)) * 100) / 100;
                return (
                  <tr key={r.id}>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 10.5, color: "var(--tm)" }}>{c?.code ?? "—"}</td>
                    <td style={{ fontSize: 11.5 }}>
                      {r.nama}
                      {r.catatan && <div style={{ fontSize: 9.5, color: "var(--td)" }}>catatan: {r.catatan}</div>}
                    </td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{c?.kategori ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{c?.unit ?? "—"}</td>
                    <td style={{ textAlign: "center", fontSize: 11.5, color: "var(--tm)" }}>{r.qty_diminta}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                        <button type="button" className="kpos-qtybtn" onClick={() => set(i, { qty_diterima: Math.max(0, (Number(r.qty_diterima) || 0) - 1) })}>−</button>
                        <input className="fi" type="number" min={0} step="any" value={r.qty_diterima}
                          onChange={(e) => set(i, { qty_diterima: Number(e.target.value) })}
                          style={{ width: 48, textAlign: "center", padding: "4px 4px" }} />
                        <button type="button" className="kpos-qtybtn" onClick={() => set(i, { qty_diterima: (Number(r.qty_diterima) || 0) + 1 })}>+</button>
                      </div>
                    </td>
                    <td style={{ textAlign: "center", fontSize: 11, fontWeight: selisih === 0 ? 400 : 700, color: selisih === 0 ? "var(--tm)" : "#b91c1c" }}>
                      {selisih === 0 ? "0" : `${selisih > 0 ? "+" : ""}${selisih}`}
                    </td>
                    <td>
                      <select className="fi" value={r.kondisi} onChange={(e) => set(i, { kondisi: e.target.value })} style={{ width: 96, fontSize: 11 }}>
                        {KONDISI.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
                      </select>
                    </td>
                    <td>
                      <input className="fi" value={r.notes} placeholder="mis. 2 karung sobek"
                        onChange={(e) => set(i, { notes: e.target.value })} style={{ minWidth: 140, fontSize: 11 }} />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button type="button" onClick={() => del(i)} className="kpos-qtybtn" style={{ color: "#b91c1c", borderColor: "#fca5a5" }} title="Hapus">
                        <i className="ti ti-trash" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Tidak ada item pada permintaan ini.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", gap: 24, marginTop: 12, paddingTop: 12, borderTop: ".5px solid var(--bd)", fontSize: 11.5 }}>
          <span>Total Item Dipesan <span style={{ fontWeight: 700, color: "var(--posb)", marginLeft: 4 }}>{summary.ordered}</span></span>
          <span>Total Item Diterima <span style={{ fontWeight: 700, color: "var(--posb)", marginLeft: 4 }}>{summary.received}</span></span>
        </div>
      </div>

      {/* Footer: catatan + ringkasan + aksi */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 24, alignItems: "center", background: "var(--sf1)", border: ".5px solid var(--bd)", borderRadius: 8, padding: "12px 16px" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--tx)" }}>RINGKASAN</div>
          <span style={{ fontSize: 11 }}>Dipesan <b>{summary.ordered}</b></span>
          <span style={{ fontSize: 11 }}>Diterima <b>{summary.received}</b></span>
          <span style={{ fontSize: 11, color: summary.selisih === 0 ? "#15803d" : "#b91c1c" }}>Selisih <b>{summary.selisih > 0 ? "+" : ""}{summary.selisih}</b></span>
        </div>
        <SubmitButton className="pay-btn" icon="ti-circle-check" style={{ width: "auto", padding: "9px 22px" }} disabled={rows.length === 0} pendingText="Menyimpan…">Simpan Penerimaan</SubmitButton>
      </div>
      <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, textAlign: "right" }}>
        Stok cabang bertambah sesuai QTY DITERIMA (bukan dipesan) — selisih tercatat di dokumen TRM.
      </div>
    </form>
  );
}
