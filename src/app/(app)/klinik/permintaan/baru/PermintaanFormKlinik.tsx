"use client";

import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { pickUnit } from "@/lib/satuan";
import { cariKatalogPermintaan, type KatalogItem } from "@/lib/permintaan";
import { buatPermintaanKlinik } from "../actions";

type Warehouse = { id: string; name: string };
type Row = { item_id: string; qty_diminta: number; satuan: string; catatan: string; cari: string };
const blank: Row = { item_id: "", qty_diminta: 1, satuan: "", catatan: "", cari: "" };

export function PermintaanFormKlinik({ branchName, warehouses, items }: {
  branchName: string; warehouses: Warehouse[]; items: KatalogItem[];
}) {
  const [rows, setRows] = useState<Row[]>([{ ...blank }]);
  const byId = new Map(items.map((item) => [item.id, item]));
  const set = (i: number, patch: Partial<Row>) => setRows((all) => all.map((row, j) => j === i ? { ...row, ...patch } : row));
  const setItem = (i: number, id: string) => {
    const item = byId.get(id);
    set(i, { item_id: id, satuan: item?.units[0]?.unit ?? "", cari: item ? `${item.code ? `${item.code} — ` : ""}${item.name}` : "" });
  };

  return (
    <form action={buatPermintaanKlinik}>
      <input type="hidden" name="items" value={JSON.stringify(rows)} />
      <div className="grid2">
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="01" title="DETAIL PERMINTAAN" desc="Cabang peminta & gudang tujuan." />
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Cabang peminta</label>
            <input className="fi" value={branchName} disabled />
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Ambil dari gudang *</label>
            <select className="fi" name="to_warehouse_id" required defaultValue="">
              <option value="" disabled>Pilih gudang</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Prioritas</label>
            <select className="fi" name="priority" defaultValue="normal">
              <option value="normal">Normal</option>
              <option value="tinggi">Tinggi</option>
              <option value="rendah">Rendah</option>
            </select>
          </div>
          <div className="fg">
            <label className="flab">Catatan</label>
            <textarea className="fi" name="catatan" rows={3} placeholder="Keterangan tambahan (opsional)…" style={{ resize: "vertical" }} />
          </div>
        </div>

        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="02" title="DAFTAR BARANG" desc="Cari seluruh master barang, lalu pilih jumlah dan satuan."
            action={<button type="button" onClick={() => setRows((all) => [...all, { ...blank }])} className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5 }}>+ Tambah item</button>} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((row, i) => {
              const item = byId.get(row.item_id);
              const units = item?.units ?? [];
              const visible = cariKatalogPermintaan(items, row.cari, row.item_id);
              const factor = item ? pickUnit(units, row.satuan).factor : 1;
              return <div key={i}>
                <input className="fi" value={row.cari} placeholder="Ketik kode atau nama barang…" onChange={(e) => set(i, { cari: e.target.value, item_id: "", satuan: "" })} style={{ marginBottom: 5 }} />
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <select className="fi" value={row.item_id} onChange={(e) => setItem(i, e.target.value)} style={{ flex: 2 }}><option value="">{row.cari ? "Pilih hasil pencarian…" : "Pilih barang…"}</option>{visible.map((m) => <option key={m.id} value={m.id}>{m.code ? `${m.code} — ` : ""}{m.name}</option>)}</select>
                  <input className="fi" type="number" min={0} step="any" value={row.qty_diminta} onChange={(e) => set(i, { qty_diminta: Number(e.target.value) })} style={{ width: 70 }} title="Qty diminta" />
                  {units.length > 1 ? <select className="fi" value={row.satuan} onChange={(e) => set(i, { satuan: e.target.value })} style={{ width: 82, flexShrink: 0 }}>{units.map((u) => <option key={u.unit} value={u.unit}>{u.unit}</option>)}</select> : <span style={{ width: 82, flexShrink: 0, fontSize: 10.5, color: "var(--tm)" }}>{row.satuan || "—"}</span>}
                  <input className="fi" value={row.catatan} placeholder="Catatan" onChange={(e) => set(i, { catatan: e.target.value })} style={{ flex: 1 }} />
                  <button type="button" onClick={() => setRows((all) => all.length > 1 ? all.filter((_, j) => j !== i) : all)} className="btn-def" style={{ padding: "0 9px", color: "#b91c1c" }} title="Hapus"><i className="ti ti-trash" /></button>
                </div>
                {factor !== 1 && units[0]?.unit && <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 2 }}>Setara {(Number(row.qty_diminta) || 0) * factor} {units[0].unit}</div>}
              </div>;
            })}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>Simpan Permintaan</SubmitButton>
      </div>
    </form>
  );
}
