"use client";

import { ProcedureBmhpField } from "@/components/ProcedureBmhpField";
import { bmhpInput, type BmhpRow } from "@/lib/procedure-bmhp";
import type { ItemUnit } from "@/lib/satuan";

type Material = { id: string; code?: string | null; name: string; unit: string; stok: number; units?: Omit<ItemUnit, "buy_price">[] };

/** Compose actual materials before the procedure joins the cart. The existing K02
 * line payload and posting engine remain the single source of stock and HPP. */
export function ProcedureBmhpComposer({ name, price, items, value, editing, onChange, onCommit, onCancel }: {
  name: string; price: number; items: Material[]; value: BmhpRow[]; editing: boolean;
  onChange: (rows: BmhpRow[]) => void; onCommit: () => void; onCancel: () => void;
}) {
  let valid = true;
  try { bmhpInput(value); } catch { valid = false; }
  return <section aria-label="Komposisi BMHP tindakan" style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: 10, marginTop: 10 }}>
    <strong style={{ fontSize: 12 }}>Komposisi BMHP tindakan</strong>
    <div style={{ fontSize: 11 }}>{name} · Rp {Math.round(price).toLocaleString("id-ID")}</div>
    <ProcedureBmhpField label={name} value={value} items={items} onChange={onChange} />
    {!valid && <div role="alert" style={{ fontSize: 10, color: "#b91c1c" }}>Periksa jumlah dan satuan BMHP.</div>}
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <button type="button" className="btn-acc" disabled={!valid} aria-label={editing ? `Simpan BMHP ${name}` : `Tambah tindakan ${name} ke keranjang`} onClick={onCommit}>
        {editing ? "Simpan BMHP tindakan" : "Tambah tindakan ke keranjang"}
      </button>
      <button type="button" className="btn-def" onClick={onCancel}>Batal</button>
    </div>
  </section>;
}
