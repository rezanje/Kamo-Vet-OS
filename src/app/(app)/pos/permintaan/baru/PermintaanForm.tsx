"use client";

// Item dipilih dari master SKU (sama pola dgn POForm), bukan diketik bebas:
// tanpa item_id stok tidak bisa dipotong/ditambah saat barang diterima.

import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { pickUnit } from "@/lib/satuan";
import type { KatalogItem } from "@/lib/permintaan";
import { buatPermintaan } from "../actions";

type Branch = { id: string; name: string };
type Warehouse = { id: string; name: string };
type Row = { item_id: string; qty_diminta: number; satuan: string; catatan: string };

const blank: Row = { item_id: "", qty_diminta: 1, satuan: "", catatan: "" };

export function PermintaanForm({
  branches, warehouses, items,
}: {
  branches: Branch[]; warehouses: Warehouse[]; items: KatalogItem[];
}) {
  const [rows, setRows] = useState<Row[]>([{ ...blank }]);
  const byId = new Map(items.map((it) => [it.id, it]));

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const setItem = (i: number, id: string) => {
    const it = byId.get(id);
    set(i, { item_id: id, satuan: it?.units[0]?.unit ?? "" });
  };

  const add = () => setRows((rs) => [...rs, { ...blank }]);
  const del = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  return (
    <form action={buatPermintaan}>
      <input type="hidden" name="items" value={JSON.stringify(rows)} />

      <div className="grid2">
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="01" title="DETAIL PERMINTAAN" desc="Cabang peminta & gudang tujuan." />
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Dari cabang *</label>
            <select className="fi" name="from_branch_id" required>
              <option value="">Pilih cabang</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Ke gudang *</label>
            <select className="fi" name="to_warehouse_id" required>
              <option value="">Pilih gudang</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="fg">
            <label className="flab">Catatan</label>
            <textarea className="fi" name="catatan" rows={3}
              placeholder="Keterangan tambahan (opsional)..." style={{ resize: "vertical" }} />
          </div>
        </div>

        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="02" title="DAFTAR BARANG" desc="Pilih barang dari master SKU, jumlah & satuannya."
            action={
              <button type="button" onClick={add} className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5 }}>
                + Tambah item
              </button>
            } />

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((r, i) => {
              const it = byId.get(r.item_id);
              const opts = it?.units ?? [];
              const faktor = it ? pickUnit(opts, r.satuan).factor : 1;
              const dasar = opts[0]?.unit;
              return (
                <div key={i}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <select className="fi" value={r.item_id} onChange={(e) => setItem(i, e.target.value)} style={{ flex: 2 }}>
                      <option value="">Pilih barang...</option>
                      {items.map((m) => (
                        <option key={m.id} value={m.id}>{m.code ? `${m.code} — ` : ""}{m.name}</option>
                      ))}
                    </select>
                    <input className="fi" type="number" min={0} step="any" value={r.qty_diminta}
                      onChange={(e) => set(i, { qty_diminta: Number(e.target.value) })}
                      style={{ width: 70 }} title="Qty diminta" />
                    {opts.length > 1 ? (
                      <select className="fi" value={r.satuan} onChange={(e) => set(i, { satuan: e.target.value })}
                        style={{ width: 78, flexShrink: 0, padding: "3px 5px", fontSize: 10.5 }} title="Satuan">
                        {opts.map((u) => <option key={u.unit} value={u.unit}>{u.unit}</option>)}
                      </select>
                    ) : (
                      <span style={{ width: 78, flexShrink: 0, fontSize: 10.5, color: r.satuan ? "var(--tm)" : "var(--td)" }}
                        title="Satuan (dari master SKU)">
                        {r.satuan || "—"}
                      </span>
                    )}
                    <input className="fi" value={r.catatan} placeholder="Catatan (opsional)"
                      onChange={(e) => set(i, { catatan: e.target.value })} style={{ flex: 1, fontSize: 11 }} />
                    <button type="button" onClick={() => del(i)} className="btn-def"
                      style={{ padding: "0 9px", color: "#b91c1c", flexShrink: 0 }} title="Hapus">
                      <i className="ti ti-trash" />
                    </button>
                  </div>
                  {faktor !== 1 && dasar && (
                    <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 2 }}>
                      Setara {(Number(r.qty_diminta) || 0) * faktor} {dasar} ({faktor} {dasar} per {r.satuan})
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
            Hanya barang berjenis Persediaan yang muncul — jasa tidak punya stok, jadi tidak bisa diminta.
            Baris tanpa barang diabaikan saat disimpan.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button type="submit" className="btn-acc">
          <i className="ti ti-device-floppy" /> Simpan permintaan
        </button>
      </div>
    </form>
  );
}
