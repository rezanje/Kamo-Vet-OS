"use client";

// Penyusun resep produksi own brand. Bentuknya sengaja mirip editor baris dokumen
// lain (satu hidden input JSON) supaya tidak ada pola baru yang harus dipelajari.

import type { ItemUnit } from "@/lib/satuan";
import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { simpanResep } from "./actions";

export type BarangPilihan = { id: string; code: string; name: string; unit: string; units?: ItemUnit[] };

type Bahan = { item_id: string; qty: number; satuan: string };

export function ResepForm({ barang }: { barang: BarangPilihan[] }) {
  const [bahan, setBahan] = useState<Bahan[]>([{ item_id: "", qty: 1, satuan: "" }]);
  const set = (i: number, patch: Partial<Bahan>) =>
    setBahan((b) => b.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const [outputId, setOutputId] = useState("");
  const [outputUnit, setOutputUnit] = useState("");
  const unitsOf = (id: string): ItemUnit[] => {
    const item = barang.find(b => b.id === id);
    return item?.units ?? (item ? [{ unit: item.unit, factor: 1, sell_price: 0, buy_price: 0 }] : []);
  };

  return (
    <form action={simpanResep} className="crm-sec">
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
        <i className="ti ti-flask-2" /> Resep produksi baru
      </div>

      <input type="hidden" name="bahan" value={JSON.stringify(bahan.filter((b) => b.item_id && b.qty > 0))} />

      <div className="frow" style={{ marginBottom: 10 }}>
        <div>
          <label className="flab">Barang jadi *</label>
          <select className="fi" name="item_id" required value={outputId} onChange={e => { setOutputId(e.target.value); setOutputUnit(unitsOf(e.target.value)[0]?.unit ?? ""); }}>
            <option value="" disabled>— pilih barang jadi —</option>
            {barang.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="flab">Nama resep *</label>
          <input className="fi" name="nama" maxLength={120} placeholder="mis. iCare 500 pcs" required />
        </div>
        <div>
          <label className="flab">Hasil per resep *</label>
          <input className="fi" type="number" name="output_qty" min={0.001} step="any" defaultValue={1} required />
          <select className="fi" name="output_unit" aria-label="Satuan hasil resep" value={outputUnit} disabled={!outputId} onChange={e => setOutputUnit(e.target.value)} style={{ marginTop: 3 }}>
            {!outputId && <option value="">— pilih barang jadi —</option>}
            {unitsOf(outputId).map(unit => <option key={unit.unit} value={unit.unit}>{unit.unit}</option>)}
          </select>
        </div>
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>Bahan</div>
      {bahan.map((b, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-end", marginBottom: 6 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            {i === 0 && <label className="flab">Barang</label>}
            <select className="fi" value={b.item_id} onChange={(e) => set(i, { item_id: e.target.value, satuan: unitsOf(e.target.value)[0]?.unit ?? "" })}>
              <option value="">— pilih bahan —</option>
              {barang.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}
            </select>
          </div>
          <div style={{ width: 130 }}>
            {i === 0 && <label className="flab">Jumlah</label>}
            <input className="fi" type="number" min={0} step="any" value={b.qty || ""}
              onChange={(e) => set(i, { qty: Number(e.target.value) })} placeholder="0" />
            {b.item_id && (
              <select className="fi" aria-label={`Satuan bahan ${i + 1}`} value={b.satuan} onChange={e => set(i, { satuan: e.target.value })} style={{ marginTop: 3 }}>
                {unitsOf(b.item_id).map(unit => <option key={unit.unit} value={unit.unit}>{unit.unit}</option>)}
              </select>
            )}
          </div>
          <button type="button" className="btn-def" style={{ padding: "4px 9px", fontSize: 10.5, color: "#b91c1c" }}
            onClick={() => setBahan((x) => (x.length > 1 ? x.filter((_, j) => j !== i) : x))}>×</button>
        </div>
      ))}

      <button type="button" className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, marginTop: 2 }}
        onClick={() => setBahan((b) => [...b, { item_id: "", qty: 1, satuan: "" }])}>
        <i className="ti ti-plus" /> Tambah bahan
      </button>

      <div style={{ marginTop: 12 }}>
        <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…">Simpan resep</SubmitButton>
      </div>
      <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
        Resep ini beda dari racik obat klinik: di sini bahan keluar gudang saat produksi dimulai,
        dan harga pokok barang jadi dihitung dari modal bahan yang benar-benar terpakai. Jumlah resep disimpan dalam satuan dasar barang.
      </div>
    </form>
  );
}
