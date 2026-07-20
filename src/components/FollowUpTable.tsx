"use client";

import { useState } from "react";
import { FOLLOWUP_JENIS, hariIniWIB, tanggalIndo } from "@/lib/followup";

export type FollowUpDraft = { jenis: string; tanggal: string; catatan: string };

// Tabel rencana follow up di rekam medis. Baris dikirim sebagai JSON lewat hidden input —
// baris follow_ups baru dibuat saat form disubmit (medical_record_id belum ada saat diisi).
export function FollowUpTable({ name }: { name: string }) {
  const [rows, setRows] = useState<FollowUpDraft[]>([]);
  const [jenis, setJenis] = useState<string>("Kontrol");
  const [tanggal, setTanggal] = useState("");
  const [catatan, setCatatan] = useState("");

  const tambah = () => {
    if (!tanggal) return;
    setRows((r) => [...r, { jenis, tanggal, catatan: catatan.trim() }]);
    setTanggal(""); setCatatan(""); setJenis("Kontrol");
  };
  const hapus = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));

  return (
    <div className="crm-sec" style={{ marginTop: 12, marginBottom: 0 }}>
      <input type="hidden" name={name} value={JSON.stringify(rows)} />

      <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--sb)", letterSpacing: ".02em", marginBottom: 4 }}>
        <i className="ti ti-calendar-event" style={{ color: "#d97706" }} /> RENCANA FOLLOW UP
      </div>
      <div style={{ fontSize: 10, color: "var(--td)", marginBottom: 10 }}>
        Tanggal di sini muncul otomatis di worklist reminder pelanggan (Klinik → Follow up).
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "150px 150px 1fr auto", gap: 8, alignItems: "end" }}>
        <div>
          <label className="flab">Jenis</label>
          <select className="fi" value={jenis} onChange={(e) => setJenis(e.target.value)}>
            {FOLLOWUP_JENIS.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
        <div>
          <label className="flab">Tanggal</label>
          <input className="fi" type="date" min={hariIniWIB()} value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
        </div>
        <div>
          <label className="flab">Catatan</label>
          <input className="fi" value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. kontrol luka jahitan, bawa hasil lab" />
        </div>
        <button type="button" onClick={tambah} disabled={!tanggal} className="btn-acc"
          style={{ padding: "7px 13px", opacity: tanggal ? 1 : .5, cursor: tanggal ? "pointer" : "not-allowed" }}>
          <i className="ti ti-plus" /> Tambah
        </button>
      </div>

      {rows.length > 0 && (
        <table className="tbl" style={{ marginTop: 10 }}>
          <thead>
            <tr><th style={{ width: 120 }}>Jenis</th><th style={{ width: 120 }}>Tanggal</th><th>Catatan</th><th style={{ width: 32 }} /></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.jenis}-${r.tanggal}-${i}`}>
                <td><span className="bge b">{r.jenis}</span></td>
                <td style={{ fontSize: 10.5 }}>{tanggalIndo(r.tanggal)}</td>
                <td style={{ fontSize: 10.5, color: r.catatan ? "var(--tx)" : "var(--td)" }}>{r.catatan || "—"}</td>
                <td style={{ textAlign: "center" }}>
                  <i className="ti ti-x" onClick={() => hapus(i)} title="Hapus"
                    style={{ cursor: "pointer", color: "#dc2626", fontSize: 13 }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
