"use client";

import { useMemo, useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { simpanHasil } from "../actions";

type Row = { item_id: string; code: string; name: string; unit: string; qty_sistem: number };

export function HasilForm({ orderId, rows }: { orderId: string; rows: Row[] }) {
  // default fisik = sistem — petugas cukup edit barang yang beda hitungannya.
  const [fisik, setFisik] = useState<Record<string, number>>(
    () => Object.fromEntries(rows.map((r) => [r.item_id, r.qty_sistem])),
  );
  const [cari, setCari] = useState("");

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
  }, [rows, cari]);

  const bedaCount = rows.filter((r) => (Number(fisik[r.item_id]) || 0) !== r.qty_sistem).length;

  return (
    <form action={simpanHasil}>
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="fisik" value={JSON.stringify(fisik)} />

      <div className="crm-sec">
        <SecHeader
          num="02"
          title="INPUT HITUNGAN FISIK"
          desc={`${rows.length} barang ber-stok di gudang ini. Qty fisik sudah terisi = sistem — ubah hanya yang hitungannya beda.`}
        />

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <input className="fi" placeholder="Cari kode / nama barang..." value={cari}
            onChange={(e) => setCari(e.target.value)} style={{ width: 260 }} />
          <div className="fg" style={{ margin: 0 }}>
            <span style={{ fontSize: 10.5, color: bedaCount ? "#b45309" : "var(--tm)" }}>
              {bedaCount} barang selisih
            </span>
          </div>
        </div>

        <div style={{ overflowX: "auto", maxHeight: 480, overflowY: "auto" }}>
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>Kode #</th>
                <th>Nama Barang</th>
                <th style={{ textAlign: "right" }}>Sistem</th>
                <th style={{ textAlign: "right" }}>Fisik</th>
                <th style={{ textAlign: "right" }}>Selisih</th>
                <th>Satuan</th>
              </tr>
            </thead>
            <tbody>
              {tampil.map((r) => {
                const f = Number(fisik[r.item_id]) || 0;
                const selisih = f - r.qty_sistem;
                return (
                  <tr key={r.item_id} style={selisih !== 0 ? { background: "#fffbeb" } : undefined}>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.code}</td>
                    <td style={{ fontSize: 11.5 }}>{r.name}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>{r.qty_sistem}</td>
                    <td style={{ textAlign: "right" }}>
                      <input className="fi" type="number" min={0} step="any"
                        value={fisik[r.item_id] ?? 0}
                        onChange={(e) => setFisik((m) => ({ ...m, [r.item_id]: Number(e.target.value) }))}
                        style={{ width: 84, textAlign: "right" }} />
                    </td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: selisih === 0 ? "var(--tm)" : selisih > 0 ? "#15803d" : "#b91c1c" }}>
                      {selisih > 0 ? "+" : ""}{selisih}
                    </td>
                    <td style={{ fontSize: 11 }}>{r.unit}</td>
                  </tr>
                );
              })}
              {tampil.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                    {rows.length === 0 ? "Tidak ada barang ber-stok di gudang ini." : "Tidak ada barang cocok pencarian."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, flexWrap: "wrap", gap: 8 }}>
          <div className="fg" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}>
            <label className="flab" style={{ margin: 0 }}>Tanggal hasil</label>
            <input className="fi" type="date" name="tanggal" defaultValue={new Date().toISOString().slice(0, 10)} style={{ width: 150 }} />
          </div>
          <button type="submit" className="btn-acc" disabled={rows.length === 0}>
            <i className="ti ti-clipboard-check" /> Simpan hasil & sesuaikan stok
          </button>
        </div>
      </div>
    </form>
  );
}
