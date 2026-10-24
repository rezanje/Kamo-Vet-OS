"use client";

import { NumberInput } from "@/components/NumberInput";

import { useState } from "react";
import type { ItemUnit } from "@/lib/satuan";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { ubahPO, batalkanPO } from "../actions";

type Row = { id: string; item_id?: string | null; nama: string; qty: number; harga_beli: number; satuan?: string | null; faktor?: number };

export function POEditForm({ userId, poId, revision, supplierId, warehouseId, tanggal, rows, suppliers, warehouses, unitOptions = {} }: {
  userId: string; poId: string; revision: number; supplierId: string; warehouseId: string; tanggal: string; rows: Row[];
  suppliers: { id: string; nama: string }[]; warehouses: { id: string; name: string }[]; unitOptions?: Record<string, ItemUnit[]>;
}) {
  const [items, setItems] = useState(rows.map(row => ({ item_id: row.item_id, nama: row.nama, qty: row.qty, harga_beli: row.harga_beli, satuan: row.satuan, faktor: row.faktor })));
  const set = (i: number, patch: Partial<Row>) => setItems(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
  return <CorrectionTransactionForm userId={userId} scope={`purchase-order:${poId}:${revision}`} action={ubahPO} state={{ snapshot: { items }, restore: value => { if (!Array.isArray(value.items)) return false; setItems(value.items); return true; }, reset: () => setItems(rows.map(row => ({ item_id: row.item_id, nama: row.nama, qty: row.qty, harga_beli: row.harga_beli, satuan: row.satuan, faktor: row.faktor }))) }}>
    {({ ready }) => <>
      <input type="hidden" name="id" value={poId} /><input type="hidden" name="revision" value={revision} />
      <label className="flab">Supplier</label><select className="fi" name="supplier_id" defaultValue={supplierId}><option value="">— Tanpa supplier —</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.nama}</option>)}</select>
      <label className="flab">Gudang tujuan</label><select className="fi" name="to_warehouse_id" defaultValue={warehouseId}>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
      <label className="flab">Tanggal PO</label><input className="fi" type="date" name="tanggal" defaultValue={tanggal} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <p style={{ fontSize: 11, color: "var(--tm)", marginTop: 10 }}>Periksa satuan dan harga beli per satuan agar modal per satuan dasar sesuai.</p>
      {items.map((row, i) => {
        const options = row.item_id ? unitOptions[row.item_id] ?? [] : [];
        const selected = options.find(unit => unit.unit === row.satuan);
        const factor = selected?.factor ?? (Number(row.faktor) || 1);
        const base = options[0]?.unit;
        return <div key={i} style={{ marginBottom: 10 }}><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input className="fi" value={row.nama} onChange={e => set(i, { nama: e.target.value })} aria-label={`Nama item ${i + 1}`} />
        <NumberInput className="fi" type="number" min={0} step="any" value={row.qty} onChange={e => set(i, { qty: Number(e.target.value) })} aria-label={`Qty item ${i + 1}`} style={{ width: 90 }} />
        {row.item_id && <select className="fi" aria-label={`Satuan item ${i + 1}`} value={row.satuan ?? ""} onChange={e => {
          const unit = options.find(option => option.unit === e.target.value);
          if (unit) set(i, { satuan: unit.unit, faktor: unit.factor });
        }} style={{ width: 90 }} required>
          {!selected && <option value={row.satuan ?? ""}>{row.satuan || "Pilih satuan"} — pilih ulang</option>}
          {options.map(unit => <option key={unit.unit} value={unit.unit}>{unit.unit}</option>)}
        </select>}
        <NumberInput className="fi" type="number" min={0} step="any" value={row.harga_beli} onChange={e => set(i, { harga_beli: Number(e.target.value) })} aria-label={`Harga item ${i + 1}`} style={{ width: 120 }} />
      </div>{base && <div style={{ fontSize: 10, color: "var(--tm)", marginTop: 4 }}>Stok masuk {Number(row.qty) * factor} {base} · modal Rp {Number(Number(row.harga_beli) / factor).toLocaleString("id-ID", { maximumFractionDigits: 2 })}/{base}</div>}</div>;
      })}
      <label className="flab">Alasan perubahan *</label><input className="fi" name="alasan" minLength={3} required placeholder="Contoh: jumlah pesanan dikoreksi" />
      <button type="submit" className="btn-acc" disabled={!ready} style={{ marginTop: 8 }}>Simpan perubahan</button>
    </>}
  </CorrectionTransactionForm>;
}

export function POCancelForm({ userId, poId, revision }: { userId: string; poId: string; revision: number }) {
  return <CorrectionTransactionForm userId={userId} scope={`purchase-order-cancel:${poId}:${revision}`} action={batalkanPO}>
    {({ ready }) => <><input type="hidden" name="id" value={poId} /><input type="hidden" name="revision" value={revision} /><label className="flab">Alasan pembatalan *</label><input className="fi" name="alasan" minLength={3} required placeholder="Contoh: supplier tidak tersedia" /><button type="submit" className="btn-def" disabled={!ready} style={{ marginTop: 8, color: "#b91c1c" }}>Batalkan PO</button></>}
  </CorrectionTransactionForm>;
}
