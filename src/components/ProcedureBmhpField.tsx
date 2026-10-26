"use client";

import { NumberInput } from "@/components/NumberInput";
import { SearchableItemPicker } from "@/components/SearchableItemPicker";
import { BMHP_MAX_COMPONENTS, type BmhpRow } from "@/lib/procedure-bmhp";
import type { ItemUnit } from "@/lib/satuan";

type BmhpItem = { id: string; code?: string | null; name: string; unit: string; stok: number; units?: ItemUnit[] };

/** K02: actual consumables used on one procedure row. Optional; stock is issued
 * only when the clinic invoice posts, and the cost becomes the procedure HPP. */
export function ProcedureBmhpField({ label, value, items, onChange }: {
  label: string; value: BmhpRow[] | undefined; items: BmhpItem[]; onChange: (rows: BmhpRow[]) => void;
}) {
  const rows = value ?? [];
  const available = items.filter(item => !rows.some(row => row.item_id === item.id));
  const unitsFor = (id: string) => {
    const item = items.find(row => row.id === id);
    const list = item?.units?.map(unit => unit.unit) ?? [];
    return item ? [item.unit, ...list.filter(unit => unit !== item.unit)] : [];
  };
  return <fieldset style={{ border: 0, padding: 0, margin: "6px 0", minWidth: 0 }}>
    <legend style={{ fontSize: 11, fontWeight: 600 }}>BMHP dipakai · {label}</legend>
    {rows.map(row => <div key={row.item_id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, marginBottom: 3 }}>
      <span style={{ flex: 1, minWidth: 0 }}>{row.nama}</span>
      <NumberInput className="fi" type="number" min={0.001} step="any" aria-label={`Jumlah BMHP ${row.nama}`} value={row.qty || ""}
        onChange={event => onChange(rows.map(item => item.item_id === row.item_id ? { ...item, qty: Number(event.target.value) } : item))}
        style={{ width: 54, padding: "1px 4px", fontSize: 10 }} />
      <select className="fi" aria-label={`Satuan BMHP ${row.nama}`} value={row.unit} style={{ width: 66, padding: "1px 3px", fontSize: 10 }}
        onChange={event => onChange(rows.map(item => item.item_id === row.item_id ? { ...item, unit: event.target.value } : item))}>
        {unitsFor(row.item_id).map(unit => <option key={unit} value={unit}>{unit}</option>)}
      </select>
      <button type="button" className="btn-def" aria-label={`Hapus BMHP ${row.nama}`} style={{ padding: "0 6px" }}
        onClick={() => onChange(rows.filter(item => item.item_id !== row.item_id))}>×</button>
    </div>)}
    {rows.length < BMHP_MAX_COMPONENTS && <SearchableItemPicker items={available.map(item => ({ id: item.id, code: item.code ?? "", name: `${item.name} (stok ${item.stok} ${item.unit})` }))}
      value="" ariaLabel={`Tambah BMHP ${label}`} placeholder="Tambah BMHP dipakai (opsional)"
      onChange={id => { const item = items.find(row => row.id === id); if (item) onChange([...rows, { item_id: item.id, nama: item.name, qty: 1, unit: item.unit }]); }} />}
    <div style={{ fontSize: 9, color: "var(--tm)" }}>Stok BMHP dipotong saat tagihan klinik disimpan; biayanya masuk HPP tindakan, harga jual tidak berubah.</div>
  </fieldset>;
}
