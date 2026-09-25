"use client";

import { useState } from "react";
import { type BahanKatalog, type KatalogRacikan, katalogTotal } from "@/lib/katalog-racikan";
import { publishKatalogRacikan, setKatalogRacikanAktif } from "./actions";

type Item = { id: string; name: string; unit: string; sell_price: number };
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function KatalogForm({ katalog, items }: { katalog: KatalogRacikan[]; items: Item[] }) {
  const [editing, setEditing] = useState<KatalogRacikan | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [form, setForm] = useState("puyer");
  const [instruction, setInstruction] = useState("");
  const [ingredients, setIngredients] = useState<BahanKatalog[]>([]);
  const [itemId, setItemId] = useState("");
  const edit = (formula: KatalogRacikan | null) => {
    setEditing(formula);
    setCode(formula?.code ?? ""); setName(formula?.name ?? "");
    setForm(formula?.dosage_form ?? "puyer");
    setInstruction(formula?.dosage_instruction ?? "");
    setIngredients(formula?.ingredients ?? []);
  };
  const addIngredient = () => {
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item || ingredients.some((ingredient) => ingredient.item_id === item.id)) return;
    setIngredients([...ingredients, {
      item_id: item.id, name: item.name, quantity: 1, unit: item.unit, unit_price: item.sell_price,
    }]);
    setItemId("");
  };

  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
    <div>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Resep resmi ({katalog.length})</div>
      {katalog.map((formula) => <div key={formula.id} style={{ border: "1px solid var(--bd)", borderRadius: 8, padding: 10, marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>{formula.code} · {formula.name}</div>
        <div style={{ fontSize: 11, color: "var(--tm)" }}>
          Versi {formula.version} · {formula.dosage_form} · {formula.ingredients.length} bahan · {rp(katalogTotal(formula.ingredients))} · {formula.active ? "Aktif" : "Nonaktif"}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" className="btn-def" onClick={() => edit(formula)}>Revisi</button>
          <form action={setKatalogRacikanAktif}>
            <input type="hidden" name="formula_id" value={formula.id} />
            <input type="hidden" name="active" value={String(!formula.active)} />
            <button type="submit" className="btn-def">{formula.active ? "Nonaktifkan" : "Aktifkan"}</button>
          </form>
        </div>
      </div>)}
    </div>
    <form action={publishKatalogRacikan} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>{editing ? `Revisi ${editing.code} (v${editing.version + 1})` : "Buat resep resmi"}</strong>
        {editing && <button type="button" className="btn-def" onClick={() => edit(null)}>Resep baru</button>}
      </div>
      <input type="hidden" name="formula_id" value={editing?.id ?? ""} />
      <input type="hidden" name="ingredients" value={JSON.stringify(ingredients.map((i) => ({
        item_id: i.item_id, quantity: i.quantity, unit: i.unit,
      })))} />
      <label className="flab">Kode resep</label>
      <input className="fi" name="code" required maxLength={40} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} readOnly={!!editing} placeholder="Mis. RACIK-001" />
      <label className="flab">Nama racikan</label>
      <input className="fi" name="name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
      <label className="flab">Bentuk dan aturan pakai standar</label>
      <select className="fi" name="dosage_form" value={form} onChange={(e) => setForm(e.target.value)}>
        {["sirup", "nebul", "salep", "puyer", "kapsul", "lainnya"].map((kind) => <option key={kind}>{kind}</option>)}
      </select>
      <input className="fi" name="dosage_instruction" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Aturan pakai (opsional)" />
      <label className="flab">Bahan dan takaran</label>
      <div style={{ display: "flex", gap: 6 }}>
        <select className="fi" value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Pilih bahan baku</option>
          {items.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}
        </select>
        <button type="button" className="btn-def" onClick={addIngredient}>Tambah</button>
      </div>
      {ingredients.map((ingredient) => <div key={ingredient.item_id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ flex: 1, fontSize: 11 }}>{ingredient.name}</span>
        <input className="fi" type="number" step="any" min="0.000001" required value={ingredient.quantity}
          onChange={(e) => setIngredients(ingredients.map((i) => i.item_id === ingredient.item_id ? { ...i, quantity: Number(e.target.value) } : i))}
          style={{ width: 65 }} />
        <span style={{ fontSize: 11 }}>{ingredient.unit}</span>
        <button type="button" className="btn-def" onClick={() => setIngredients(ingredients.filter((i) => i.item_id !== ingredient.item_id))}>Hapus</button>
      </div>)}
      <div style={{ fontSize: 11 }}>Estimasi harga bahan: {rp(katalogTotal(ingredients))}</div>
      <button type="submit" className="btn-acc" disabled={!code || !name.trim() || !ingredients.length || ingredients.some((i) => !(i.quantity > 0))}>Terbitkan versi</button>
    </form>
  </div>;
}
