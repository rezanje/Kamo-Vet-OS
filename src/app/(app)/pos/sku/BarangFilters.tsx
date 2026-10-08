"use client";

import Link from "next/link";
import { useState } from "react";
import { ITEM_TYPES } from "@/lib/barang";
import { buildTree, labelPath, type KategoriRow } from "@/lib/kategori";

export function BarangFilters({ categories, parentId, childId, jenis, cari }: {
  categories: KategoriRow[]; parentId: string; childId: string; jenis: string; cari: string;
}) {
  const tree = buildTree(categories);
  const [parent, setParent] = useState(parentId);
  const [child, setChild] = useState(childId);
  const children = tree.find(row => row.induk.id === parent)?.anak ?? [];
  return (
    <form action="/pos/sku" className="crm-sec" style={{ marginBottom: 12, padding: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ width: 230 }}>
          <label className="flab" htmlFor="sku-cari">Cari barang</label>
          <input id="sku-cari" className="fi" name="cari" defaultValue={cari} placeholder="Kode atau nama barang" />
        </div>
        <div style={{ width: 150 }}>
          <label className="flab" htmlFor="sku-jenis">Jenis</label>
          <select id="sku-jenis" className="fi" name="jenis" defaultValue={jenis}>
            <option value="">Semua jenis</option>
            {ITEM_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>
        <div style={{ width: 220 }}>
          <label className="flab" htmlFor="sku-induk">Kategori induk</label>
          <select id="sku-induk" className="fi" name="induk" value={parent} onChange={event => { setParent(event.target.value); setChild(""); }}>
            <option value="">Semua kategori</option>
            {tree.map(({ induk }) => <option key={induk.id} value={induk.id}>{induk.name}{induk.is_active ? "" : " (Nonaktif)"}</option>)}
          </select>
        </div>
        <div style={{ width: 230 }}>
          <label className="flab" htmlFor="sku-kat">Subkategori</label>
          <select id="sku-kat" className="fi" name="kat" value={child} onChange={event => setChild(event.target.value)} disabled={!children.length}>
            <option value="">Semua subkategori</option>
            {children.map(row => <option key={row.id} value={row.id}>{row.parent_id === parent ? row.name : labelPath(row.id, categories).split(" › ").slice(1).join(" › ")}{row.is_active ? "" : " (Nonaktif)"}</option>)}
          </select>
        </div>
        <button type="submit" className="btn-acc" style={{ background: "var(--posb)" }}><i className="ti ti-filter" /> Terapkan</button>
        <Link href="/pos/sku" className="btn-def" style={{ textDecoration: "none" }}>Reset</Link>
      </div>
      <div style={{ fontSize: 10, color: "var(--td)", marginTop: 7 }}>Pilih kategori induk dan subkategori, lalu tekan Terapkan.</div>
    </form>
  );
}
