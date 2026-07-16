"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type PersRow = {
  id: string;
  no: string;
  createdAt: string; // ISO
  dari: string;
  tujuan: string;
  itemCount: number;
  status: string;
  dibuatOleh: string;
};

// Status → warna badge + dot + deskripsi (selaras referensi UI).
const STATUS = [
  { k: "Menunggu Persetujuan", cls: "b", dot: "#1d4ed8", desc: "Menunggu persetujuan dari gudang" },
  { k: "Disetujui", cls: "g", dot: "#15803d", desc: "Permintaan telah disetujui" },
  { k: "Dikirim", cls: "o", dot: "#b55a35", desc: "Barang sedang dikirim" },
  { k: "Selesai", cls: "g", dot: "#15803d", desc: "Barang telah diterima toko" },
  { k: "Ditolak", cls: "r", dot: "#b91c1c", desc: "Permintaan ditolak" },
];
const badgeCls = (s: string) => STATUS.find((x) => x.k === s)?.cls ?? "x";

const dateOnly = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });
const timeOnly = (iso: string) => new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
const isoDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);

const PAGE_SIZE = 8;

export function PersediaanTable({ rows, tab }: { rows: PersRow[]; tab: "permintaan" | "penerimaan" }) {
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status && r.status !== status) return false;
      const day = isoDay(r.createdAt);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (s && !(r.no.toLowerCase().includes(s) || r.dari.toLowerCase().includes(s) || r.tujuan.toLowerCase().includes(s))) return false;
      return true;
    });
  }, [rows, status, from, to, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  const colCount = 8; // No, Tanggal, Dari, Tujuan, Total Item, Status, Dibuat Oleh, Aksi

  const reset = () => setPage(1);

  return (
    <>
      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select className="fi" value={status} onChange={(e) => { setStatus(e.target.value); reset(); }} style={{ width: "auto", minWidth: 150, fontSize: 11.5 }}>
          <option value="">Semua Status</option>
          {STATUS.map((s) => <option key={s.k} value={s.k}>{s.k}</option>)}
        </select>
        <input className="fi" type="date" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} style={{ width: "auto", fontSize: 11.5 }} />
        <span style={{ fontSize: 11, color: "var(--td)" }}>s/d</span>
        <input className="fi" type="date" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} style={{ width: "auto", fontSize: 11.5 }} />
        <div style={{ marginLeft: "auto", position: "relative", width: 260, maxWidth: "100%" }}>
          <input className="fi" placeholder="Cari nomor permintaan / gudang..." value={q}
            onChange={(e) => { setQ(e.target.value); reset(); }} style={{ fontSize: 11.5, paddingRight: 28 }} />
          <i className="ti ti-search" style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--td)", fontSize: 13 }} />
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 900 }}>
          <thead>
            <tr>
              <th>No. Permintaan</th>
              <th>Tanggal</th>
              <th>Dari (Toko)</th>
              <th>Tujuan (Gudang)</th>
              <th style={{ textAlign: "center" }}>Total Item</th>
              <th>Status</th>
              <th>Dibuat Oleh</th>
              <th style={{ textAlign: "center" }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 500, fontSize: 11.5, color: "var(--posb)" }}>{r.no}</td>
                <td style={{ fontSize: 11 }}>
                  <div>{dateOnly(r.createdAt)}</div>
                  <div style={{ fontSize: 9.5, color: "var(--td)" }}>{timeOnly(r.createdAt)}</div>
                </td>
                <td style={{ fontSize: 11.5 }}>{r.dari}</td>
                <td style={{ fontSize: 11.5 }}>{r.tujuan}</td>
                <td style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>{r.itemCount}</div>
                  <div style={{ fontSize: 9, color: "var(--td)" }}>Item</div>
                </td>
                <td><span className={`bge ${badgeCls(r.status)}`}>{r.status}</span></td>
                <td style={{ fontSize: 11.5 }}>{r.dibuatOleh}</td>
                <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                  <Link href={`/kasir/persediaan/${r.id}`} className="kpos-pagebtn" style={{ textDecoration: "none", display: "inline-flex" }} title="Lihat detail">
                    <i className="ti ti-eye" />
                  </Link>
                  {tab === "penerimaan" && r.status === "Dikirim" && (
                    <Link href={`/kasir/persediaan/terima/${r.id}`} className="btn-acc" style={{ textDecoration: "none", padding: "4px 10px", fontSize: 10.5, marginLeft: 6 }}>
                      <i className="ti ti-package-import" /> Terima
                    </Link>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={colCount} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  {tab === "penerimaan" ? "Belum ada barang yang perlu diterima." : "Belum ada permintaan barang."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {filtered.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button className="kpos-pagebtn" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}><i className="ti ti-chevron-left" /></button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
              <button key={n} className={`kpos-pagebtn ${n === safePage ? "on" : ""}`} onClick={() => setPage(n)}>{n}</button>
            ))}
            <button className="kpos-pagebtn" disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}><i className="ti ti-chevron-right" /></button>
          </div>
          <span style={{ fontSize: 10.5, color: "var(--td)" }}>
            Menampilkan {filtered.length === 0 ? 0 : start + 1}–{Math.min(start + PAGE_SIZE, filtered.length)} dari {filtered.length} data
          </span>
        </div>
      )}

      {/* Keterangan Status */}
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: ".5px solid var(--bd)" }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--tm)", marginBottom: 8 }}>Keterangan Status</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 24px" }}>
          {STATUS.map((s) => (
            <div key={s.k} style={{ display: "flex", alignItems: "flex-start", gap: 7, minWidth: 180 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.dot, marginTop: 4, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: s.dot }}>{s.k}</div>
                <div style={{ fontSize: 9.5, color: "var(--td)" }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
