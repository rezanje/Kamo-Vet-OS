"use client";

import { useState } from "react";
import { simpanRekamMedis } from "./actions";

type Row = { nama_obat: string; qty: number; aturan_pakai: string };

const blank: Row = { nama_obat: "", qty: 1, aturan_pakai: "" };

export function RekamForm({ visitId }: { visitId: string }) {
  const [rows, setRows] = useState<Row[]>([{ ...blank }]);

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRows((rs) => [...rs, { ...blank }]);
  const del = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  return (
    <form action={simpanRekamMedis}>
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="resep" value={JSON.stringify(rows)} />

      <div className="grid2">
        <div className="card">
          <div className="card-hd">
            <i className="ti ti-stethoscope" style={{ color: "var(--acc)" }} /> Pemeriksaan
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Anamnesis / catatan klinis</label>
            <textarea className="fi" name="anamnesis" rows={4}
              placeholder="Riwayat, gejala, hasil pemeriksaan fisik..." style={{ resize: "vertical" }} />
          </div>
          <div className="fg">
            <label className="flab">Diagnosa</label>
            <textarea className="fi" name="diagnosis" rows={3}
              placeholder="Mis. Gastroenteritis akut" style={{ resize: "vertical" }} />
          </div>
        </div>

        <div className="card">
          <div className="card-hd" style={{ justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <i className="ti ti-prescription" style={{ color: "#16a34a" }} /> Resep obat
            </span>
            <button type="button" onClick={add} className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5 }}>
              + Tambah obat
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: 9 }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <input className="fi" placeholder="Nama obat" value={r.nama_obat}
                    onChange={(e) => set(i, { nama_obat: e.target.value })} style={{ flex: 1 }} />
                  <input className="fi" type="number" min={1} value={r.qty}
                    onChange={(e) => set(i, { qty: Number(e.target.value) })}
                    style={{ width: 64 }} title="Qty" />
                  <button type="button" onClick={() => del(i)} className="btn-def"
                    style={{ padding: "0 9px", color: "#b91c1c" }} title="Hapus">
                    <i className="ti ti-trash" />
                  </button>
                </div>
                <input className="fi" placeholder="Aturan pakai — mis. 2x sehari 1 tablet sesudah makan"
                  value={r.aturan_pakai} onChange={(e) => set(i, { aturan_pakai: e.target.value })} />
              </div>
            ))}
          </div>
          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
            Aturan pakai dicatat per obat (PRD §3.5), bukan satu catatan gabungan.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button type="submit" className="btn-acc">
          <i className="ti ti-circle-check" /> Simpan &amp; selesaikan kunjungan
        </button>
      </div>
    </form>
  );
}
