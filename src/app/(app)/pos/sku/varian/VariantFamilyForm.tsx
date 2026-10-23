"use client";

import { ItemReferenceField } from "@/components/ItemReferenceField";
import { useState } from "react";
import { saveVariantFamily } from "./actions";

type Item = { id: string; code: string; name: string };
type Category = { id: string; name: string };

export function VariantFamilyForm({ items, categories }: { items: Item[]; categories: Category[] }) {
  const [members, setMembers] = useState([0, 1]);
  return (
    <form action={saveVariantFamily} className="crm-sec" style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--sb)" }}>Tambah Keluarga Varian</div>
      <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 3 }}>Harga dan stok tetap milik tiap SKU.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 8, marginTop: 12 }}>
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
        {members.map((slot, index) => (
          <div key={slot} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 7, alignItems: "end" }}>
            <label className="flab">SKU {index + 1}
              <ItemReferenceField name="item_id" items={items} required ariaLabel={`SKU varian ${index + 1}`} />
            </label>
            <label className="flab">Label tampilan
              <input className="fi" name="label" required placeholder="400 gr" />
            </label>
            {members.length > 2 && <button type="button" className="btn-def" aria-label={`Hapus SKU ${index + 1}`} onClick={() => setMembers((current) => current.filter((_, i) => i !== index))}><i className="ti ti-trash" /></button>}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button type="button" className="btn-def" onClick={() => setMembers((current) => [...current, Math.max(...current) + 1])}><i className="ti ti-plus" /> Tambah SKU</button>
        <button type="submit" className="btn-acc" style={{ background: "#15803d" }}><i className="ti ti-device-floppy" /> Simpan keluarga</button>
      </div>
    </form>
  );
}
