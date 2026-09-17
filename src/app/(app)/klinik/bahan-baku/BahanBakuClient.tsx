"use client";

import { useMemo, useState, useTransition } from "react";
import { filterBahanRacikan } from "@/lib/bahan-racikan";
import { setBahanBaku, setBahanBakuBanyak } from "./actions";

export type ItemRow = { id: string; code: string; name: string; kategori: string; sell_price: number; is_compound_material: boolean };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function BahanBakuClient({ items }: { items: ItemRow[] }) {
  const [q, setQ] = useState("");
  const [kategori, setKategori] = useState("__selected__");
  const [rows, setRows] = useState(items);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  const categories = useMemo(() => [...new Set(rows.map((r) => r.kategori))].sort((a, b) => a.localeCompare(b, "id")), [rows]);
  const shown = useMemo(() => filterBahanRacikan(rows, { q, kategori }), [rows, q, kategori]);

  const toggle = (id: string, value: boolean) => {
    setMessage("");
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, is_compound_material: value } : r))); // optimistik
    start(async () => {
      const res = await setBahanBaku(id, value);
      if (!res.ok) {
        setRows((rs) => rs.map((r) => (r.id === id ? { ...r, is_compound_material: !value } : r))); // rollback
        setMessage(res.error);
      }
    });
  };

  const setSemuaTerlihat = (value: boolean) => {
    const ids = shown.map((row) => row.id);
    if (ids.length === 0) return;
    const before = new Map(rows.filter((row) => ids.includes(row.id)).map((row) => [row.id, row.is_compound_material]));
    setMessage("");
    setRows((current) => current.map((row) => ids.includes(row.id) ? { ...row, is_compound_material: value } : row));
    start(async () => {
      const res = await setBahanBakuBanyak(ids, value);
      if (!res.ok) {
        setRows((current) => current.map((row) => before.has(row.id) ? { ...row, is_compound_material: before.get(row.id)! } : row));
        setMessage(res.error);
        return;
      }
      setMessage(`${res.updated} barang berhasil ${value ? "dipilih" : "dilepas"}.`);
    });
  };

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <select className="fi" value={kategori} onChange={(e) => { setKategori(e.target.value); setQ(""); }} style={{ width: 220 }}>
          <option value="__selected__">Bahan yang sudah dipilih</option>
          {categories.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <div style={{ position: "relative", width: 280, maxWidth: "100%" }}>
          <input className="fi" placeholder="Cari nama / kode barang..." value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingRight: 28 }} />
          <i className="ti ti-search" style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--td)", fontSize: 13 }} />
        </div>
        {kategori !== "__selected__" && (
          <button type="button" className="btn-acc" disabled={pending || shown.length === 0} onClick={() => setSemuaTerlihat(true)}>
            <i className="ti ti-checks" /> Pilih semua hasil ({shown.length})
          </button>
        )}
        {kategori === "__selected__" && shown.length > 0 && (
          <button type="button" className="btn-def" disabled={pending} onClick={() => setSemuaTerlihat(false)}>
            Lepas semua hasil ({shown.length})
          </button>
        )}
      </div>
      <div style={{ fontSize: 10.5, color: message.includes("berhasil") ? "#15803d" : message ? "#dc2626" : "var(--tm)", marginBottom: 10 }}>
        {message || (kategori === "__selected__" ? "Daftar awal hanya menampilkan bahan racikan yang sudah dipilih." : "Pilih semua hanya berlaku untuk kategori dan pencarian yang sedang tampil.")}
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
