"use client";

import { useState } from "react";
import { kategoriWajibConsent } from "@/lib/tindakan";

type ServiceItem = { id: string; name: string; sell_price: number; tindakan_kategori?: string | null };
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function ClinicServicePicker<T extends ServiceItem>({ kind, items, onAdd }: {
  kind: "Jasa" | "Tindakan"; items: T[]; onAdd: (item: T) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const label = kind.toLowerCase();
  const matches = items.filter(item => item.name.toLowerCase().includes(search.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(matches.length / 40));
  const currentPage = Math.min(page, pages);
  return <section aria-label={`Pilihan ${label}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <input className="fi" aria-label={`Cari ${label}`} placeholder={`Cari ${label}...`} value={search}
      onChange={event => { setSearch(event.target.value); setPage(1); }} />
    <div style={{ maxHeight: 210, overflowY: "auto", border: ".5px solid var(--bd)", borderRadius: 8 }}>
      {!items.length && <div style={{ fontSize: 10.5, color: "var(--td)", padding: 10 }}>
        Belum ada item kategori {kind}. Tambahkan di Barang &amp; Jasa.
      </div>}
      {!!items.length && !matches.length && <div style={{ fontSize: 10.5, color: "var(--td)", padding: 10 }}>Tidak ada {label} cocok.</div>}
      {matches.slice((currentPage - 1) * 40, currentPage * 40).map(item => <div key={item.id}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", borderBottom: ".5px solid var(--bd)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 500 }}>{item.name}</div>
          <div style={{ fontSize: 9, color: "var(--tm)", display: "flex", alignItems: "center", gap: 5 }}>
            {rp(item.sell_price)}
            {item.tindakan_kategori && <span className={`bge ${kategoriWajibConsent(item.tindakan_kategori) ? "r" : "b"}`} style={{ fontSize: 8 }}>{item.tindakan_kategori}</span>}
          </div>
        </div>
        <button type="button" aria-label={`Tambah ${item.name}`} onClick={() => onAdd(item)} className="btn-acc"
          style={{ padding: "3px 8px", background: "var(--posb)" }}><i className="ti ti-plus" /></button>
      </div>)}
    </div>
    {pages > 1 && <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 10.5 }}>
      <button type="button" className="btn-def" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Sebelumnya</button>
      <span>{currentPage}/{pages}</span>
      <button type="button" className="btn-def" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Berikutnya</button>
    </div>}
    <div style={{ fontSize: 9, color: "var(--td)" }}>{kind} &amp; tarifnya mengikuti Barang &amp; Jasa.</div>
  </section>;
}
