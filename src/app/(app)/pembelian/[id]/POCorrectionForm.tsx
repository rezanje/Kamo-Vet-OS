"use client";

import { useState } from "react";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { ubahPO, batalkanPO } from "../actions";

type Row = { id: string; item_id?: string | null; nama: string; qty: number; harga_beli: number; satuan?: string | null; faktor?: number };

export function POEditForm({ userId, poId, revision, supplierId, warehouseId, tanggal, rows, suppliers, warehouses }: {
  userId: string; poId: string; revision: number; supplierId: string; warehouseId: string; tanggal: string; rows: Row[];
  suppliers: { id: string; nama: string }[]; warehouses: { id: string; name: string }[];
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
      {items.map((row, i) => <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <input className="fi" value={row.nama} onChange={e => set(i, { nama: e.target.value })} aria-label={`Nama item ${i + 1}`} />
        <input className="fi" type="number" min={0} step="any" value={row.qty} onChange={e => set(i, { qty: Number(e.target.value) })} aria-label={`Qty item ${i + 1}`} style={{ width: 90 }} />
        <input className="fi" type="number" min={0} step="any" value={row.harga_beli} onChange={e => set(i, { harga_beli: Number(e.target.value) })} aria-label={`Harga item ${i + 1}`} style={{ width: 120 }} />
      </div>)}
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
