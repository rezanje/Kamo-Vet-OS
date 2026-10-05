"use client";

import { useState } from "react";
type Sku = { id: string; code?: string | null; name: string; unit: string; sell_price: number; stok: number };
const rp = (value: number) => "Rp " + Math.round(value).toLocaleString("id-ID");

export function CompoundSkuList<T extends Sku>({ items, onAdd }: { items: T[]; onAdd: (item: T) => void }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const term = search.trim().toLowerCase();
  const matches = items.filter(item => `${item.name} ${item.code ?? ""}`.toLowerCase().includes(term));
  const pages = Math.max(1, Math.ceil(matches.length / 50));
  const currentPage = Math.min(page, pages);
  const visible = matches.slice((currentPage - 1) * 50, currentPage * 50);
  return <section aria-label="Obat racik dari Barang & Jasa" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <strong style={{ fontSize: 11.5 }}>Obat racik dari Barang &amp; Jasa ({items.length})</strong>
    <input className="fi" aria-label="Cari obat racik" placeholder="Cari nama / kode obat racik…" value={search}
      onChange={event => { setSearch(event.target.value); setPage(1); }} />
    <div style={{ maxHeight: 250, overflowY: "auto", border: ".5px solid var(--bd)", borderRadius: 8 }}>
      {visible.map(item => <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 9px", borderBottom: ".5px solid var(--bd)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 500 }}>{item.name}</div>
          <div style={{ fontSize: 9.5, color: "var(--tm)" }}>{item.code ? `${item.code} · ` : ""}Stok {item.stok} {item.unit} · {rp(item.sell_price)}</div>
        </div>
        <button type="button" className="btn-acc" aria-label={`Tambah ${item.name}`} onClick={() => onAdd(item)}
          style={{ padding: "3px 8px", background: "#16a34a" }}><i className="ti ti-plus" /></button>
      </div>)}
      {!visible.length && <div style={{ fontSize: 10.5, color: "var(--td)", padding: 10 }}>
        {items.length ? "Tidak ada obat racik yang cocok." : "Belum ada SKU aktif pada kategori Obat Racik di Barang & Jasa."}
      </div>}
    </div>
    {pages > 1 && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, fontSize: 10 }}>
      <button type="button" className="btn-def" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Sebelumnya</button>
      <span>{currentPage}/{pages} · {matches.length} obat</span>
      <button type="button" className="btn-def" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Berikutnya</button>
    </div>}
    <div style={{ fontSize: 9.5, color: "var(--tm)" }}>Mengikuti stok, satuan, dan harga dari Barang &amp; Jasa.</div>
  </section>;
}
