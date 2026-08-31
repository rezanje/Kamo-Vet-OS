"use client";

import { useState } from "react";
import { saveVariantFamily } from "./actions";

type Item = { id: string; code: string; name: string };
type Category = { id: string; name: string };

export function VariantFamilyForm({ items, categories }: { items: Item[]; categories: Category[] }) {
  const [members, setMembers] = useState(["", ""]);
  return (
    <form action={saveVariantFamily} className="crm-sec" style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--sb)" }}>Tambah Keluarga Varian</div>
      <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 3 }}>Harga dan stok tetap milik tiap SKU.</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(180px, .7fr)", gap: 8, marginTop: 12 }}>
        <label className="flab">Nama keluarga
          <input className="fi" name="name" required placeholder="Contoh: Shampo Anti Kutu" />
        </label>
        <label className="flab">Kategori
          <select className="fi" name="category_id" defaultValue="">
            <option value="">Tanpa kategori</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
      </div>
      <div style={{ marginTop: 12, display: "grid", gap: 7 }}>
        {members.map((_, index) => (
          <div key={index} style={{ display: "grid", gridTemplateColumns: "minmax(240px, 1fr) minmax(160px, .6fr) auto", gap: 7, alignItems: "end" }}>
            <label className="flab">SKU {index + 1}
              <select className="fi" name="item_id" required value={members[index]} onChange={(event) => setMembers((current) => current.map((value, i) => i === index ? event.target.value : value))}>
                <option value="">Pilih SKU…</option>
                {items.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
              </select>
            </label>
            <label className="flab">Label tampilan
              <input className="fi" name="label" required placeholder="400 gr" />
            </label>
            {members.length > 2 && <button type="button" className="btn-def" onClick={() => setMembers((current) => current.filter((_, i) => i !== index))}><i className="ti ti-trash" /></button>}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button type="button" className="btn-def" onClick={() => setMembers((current) => [...current, ""])}><i className="ti ti-plus" /> Tambah SKU</button>
        <button type="submit" className="btn-acc" style={{ background: "#15803d" }}><i className="ti ti-device-floppy" /> Simpan keluarga</button>
      </div>
    </form>
  );
}
