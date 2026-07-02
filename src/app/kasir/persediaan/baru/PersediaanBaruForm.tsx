"use client";

import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { buatPermintaanKasir } from "../actions";

type Warehouse = { id: string; name: string };
type Row = { nama: string; qty_diminta: number };

const blank: Row = { nama: "", qty_diminta: 1 };

export function PersediaanBaruForm({ branchName, warehouses }: { branchName: string; warehouses: Warehouse[] }) {
  const [rows, setRows] = useState<Row[]>([{ ...blank }]);

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRows((rs) => [...rs, { ...blank }]);
  const del = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  return (
    <form action={buatPermintaanKasir}>
      <input type="hidden" name="items" value={JSON.stringify(rows)} />

      <div className="grid2">
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="01" title="DETAIL PERMINTAAN" desc="Cabang peminta & gudang tujuan." />
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Dari cabang</label>
            <input className="fi" value={branchName} disabled style={{ background: "var(--sf1)", color: "var(--tm)" }} />
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Ke gudang *</label>
            <select className="fi" name="to_warehouse_id" required defaultValue="">
              <option value="" disabled>Pilih gudang DC</option>
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
          <SecHeader num="02" title="DAFTAR BARANG" desc="Item yang diminta beserta jumlahnya."
            action={
              <button type="button" onClick={add} className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5 }}>
                + Tambah item
              </button>
            } />

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 6 }}>
                <input className="fi" placeholder="Nama barang" value={r.nama}
                  onChange={(e) => set(i, { nama: e.target.value })} style={{ flex: 1 }} />
                <input className="fi" type="number" min={0} step="any" value={r.qty_diminta}
                  onChange={(e) => set(i, { qty_diminta: Number(e.target.value) })}
                  style={{ width: 80 }} title="Qty diminta" />
                <button type="button" onClick={() => del(i)} className="btn-def"
                  style={{ padding: "0 9px", color: "#b91c1c" }} title="Hapus">
                  <i className="ti ti-trash" />
                </button>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
            Baris tanpa nama barang akan diabaikan saat disimpan.
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
