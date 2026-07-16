"use client";

import { useMemo, useState, useTransition } from "react";
import { setBahanBaku } from "./actions";

export type ItemRow = { id: string; code: string; name: string; kategori: string; sell_price: number; is_compound_material: boolean };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function BahanBakuClient({ items }: { items: ItemRow[] }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(items);
  const [pending, start] = useTransition();

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => !s || r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
  }, [rows, q]);

  const toggle = (id: string, value: boolean) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, is_compound_material: value } : r))); // optimistik
    start(async () => {
      const res = await setBahanBaku(id, value);
      if (!res.ok) setRows((rs) => rs.map((r) => (r.id === id ? { ...r, is_compound_material: !value } : r))); // rollback
    });
  };

  return (
    <>
      <div style={{ position: "relative", width: 280, maxWidth: "100%", marginBottom: 12 }}>
        <input className="fi" placeholder="Cari nama / kode barang..." value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingRight: 28 }} />
        <i className="ti ti-search" style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--td)", fontSize: 13 }} />
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 640 }}>
          <thead><tr><th>Kode</th><th>Nama Barang</th><th>Kategori</th><th style={{ textAlign: "right" }}>Harga Jual</th><th style={{ textAlign: "center" }}>Bahan Baku Racikan</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td style={{ fontFamily: "monospace", fontSize: 10.5, color: "var(--tm)" }}>{r.code}</td>
                <td style={{ fontSize: 11.5, fontWeight: 500 }}>{r.name}</td>
                <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.kategori}</td>
                <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.sell_price)}</td>
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" checked={r.is_compound_material} disabled={pending}
                    onChange={(e) => toggle(r.id, e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }} />
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>Barang tidak ditemukan.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
