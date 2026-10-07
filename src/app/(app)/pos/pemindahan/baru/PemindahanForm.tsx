"use client";

import { LocalTransactionDraft, usePreservedAction } from "@/components/LocalTransactionDraft";
import type { ItemUnit } from "@/lib/satuan";
import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buatKirim } from "../actions";
import { hariIniWIB } from "@/lib/tanggal";

type Warehouse = { id: string; name: string };
type Item = { id: string; code: string; name: string; unit: string; units: ItemUnit[] };
type Row = { display: string; item_id: string; qty: number; satuan: string };

const blank: Row = { display: "", item_id: "", qty: 1, satuan: "" };
const label = (it: Item) => `${it.code} — ${it.name}`;

export function PemindahanForm({ warehouses, items, userId }: { warehouses: Warehouse[]; items: Item[]; userId: string }) {
  const { save, failure } = usePreservedAction(buatKirim);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [rows, setRows] = useState<Row[]>([{ ...blank }]);

  const byLabel = new Map(items.map((it) => [label(it), it]));

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRows((rs) => [...rs, { ...blank }]);
  const del = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  const onDisplay = (i: number, v: string) => {
    const it = byLabel.get(v);
    set(i, { display: v, item_id: it?.id ?? "", satuan: it?.units[0]?.unit ?? "" });
  };

  const payload = rows.filter((r) => r.item_id).map((r) => ({ item_id: r.item_id, qty: r.qty, satuan: r.satuan }));

  return (
    <form action={save}>
      <LocalTransactionDraft userId={userId} scope="pos:pemindahan:baru" state={{ snapshot: { rows, requestKey }, reset: () => { setRows([{ ...blank }]); setRequestKey(crypto.randomUUID()); }, restore: (value) => { const draft = value as { rows?: Row[]; requestKey?: string }; if (Array.isArray(draft.rows)) setRows(draft.rows); if (draft.requestKey) setRequestKey(draft.requestKey); return true; } }} />
      <input type="hidden" name="request_key" value={requestKey} />
      {failure && <div role="alert" className="p2ban">{failure}</div>}
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      <datalist id="pemindahan-items">
        {items.map((it) => <option key={it.id} value={label(it)} />)}
      </datalist>

      <div className="grid2">
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="01" title="DETAIL PENGIRIMAN" desc="Gudang asal, tujuan, dan tanggal kirim." />
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Gudang asal *</label>
            <select className="fi" name="from_warehouse_id" required>
              <option value="">Pilih gudang</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Gudang tujuan *</label>
            <select className="fi" name="to_warehouse_id" required>
              <option value="">Pilih gudang</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Tanggal *</label>
            <input className="fi" type="date" name="tanggal" defaultValue={hariIniWIB()} required />
          </div>
          <div className="fg">
            <label className="flab">Keterangan</label>
            <textarea className="fi" name="keterangan" rows={3}
              placeholder="Keterangan tambahan (opsional)..." style={{ resize: "vertical" }} />
          </div>
        </div>

        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="02" title="RINCIAN BARANG" desc="Cari barang dari master SKU, isi kuantitas."
            action={
              <button type="button" onClick={add} className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5 }}>
                + Tambah barang
              </button>
            } />

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((r, i) => {
              const it = r.item_id ? byLabel.get(r.display) : undefined;
              return (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input className="fi" list="pemindahan-items" placeholder="Kode / nama barang" value={r.display}
                    onChange={(e) => onDisplay(i, e.target.value)} style={{ flex: 1 }} />
                  <input className="fi" type="number" min={0} step="any" value={r.qty}
                    onChange={(e) => set(i, { qty: Number(e.target.value) })}
                    style={{ width: 80 }} title="Kuantitas" />
                  <select className="fi" aria-label="Satuan barang" value={r.satuan} onChange={e => set(i, { satuan: e.target.value })} style={{ width: 90 }}>{(it?.units ?? []).map(u => <option key={u.unit} value={u.unit}>{u.unit}</option>)}</select>
                  <button type="button" onClick={() => del(i)} className="btn-def"
                    style={{ padding: "0 9px", color: "#b91c1c" }} title="Hapus">
                    <i className="ti ti-trash" />
                  </button>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
            Ketik kode atau nama barang. Seluruh master barang persediaan tersedia; baris kosong diabaikan.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <SubmitButton className="btn-acc" disabled={payload.length === 0} icon="ti-truck-delivery" pendingText="Menyimpan pemindahan…">
          Kirim barang
        </SubmitButton>
      </div>
    </form>
  );
}
