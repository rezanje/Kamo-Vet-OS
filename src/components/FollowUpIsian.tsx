"use client";

import type { ReactNode } from "react";
import { FOLLOWUP_JENIS, PINTASAN_FOLLOWUP, tanggalSetelah } from "@/lib/followup";
import { hariIniWIB } from "@/lib/tanggal";

/**
 * Isian satu jadwal follow up (jenis, tanggal + tombol cepat, catatan). Dipakai form
 * pemeriksaan dan panel follow up di halaman detail rekam medis. `names` diisi bila
 * nilainya dikirim langsung sebagai field form.
 */
export function FollowUpIsian({ jenis, tanggal, catatan, onJenis, onTanggal, onCatatan, aksi, names }: {
  jenis: string; tanggal: string; catatan: string;
  onJenis: (v: string) => void; onTanggal: (v: string) => void; onCatatan: (v: string) => void;
  aksi?: ReactNode;
  names?: { jenis: string; tanggal: string; catatan: string };
}) {
  const today = hariIniWIB();
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, alignItems: "end" }}>
        <div>
          <label className="flab">Jenis</label>
          <select className="fi" aria-label="Jenis follow up" name={names?.jenis} value={jenis} onChange={(e) => onJenis(e.target.value)}>
            {FOLLOWUP_JENIS.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
        <div>
          <label className="flab">Tanggal</label>
          <input className="fi" type="date" aria-label="Tanggal follow up" name={names?.tanggal} min={today} value={tanggal}
            required={!!names} onChange={(e) => onTanggal(e.target.value)} />
        </div>
        <div style={{ gridColumn: "span 2", minWidth: 0 }}>
          <label className="flab">Catatan</label>
          <input className="fi" aria-label="Catatan follow up" name={names?.catatan} value={catatan} maxLength={1000}
            onChange={(e) => onCatatan(e.target.value)} placeholder="mis. vaksin rabies, kontrol luka jahitan" />
        </div>
        {aksi && <div>{aksi}</div>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "var(--tm)" }}>Isi cepat tanggal:</span>
        {PINTASAN_FOLLOWUP.map((p) => (
          <button key={p.label} type="button" className="btn-def" style={{ padding: "2px 8px", fontSize: 10 }}
            onClick={() => onTanggal(tanggalSetelah(today, p))}>{p.label}</button>
        ))}
      </div>
    </div>
  );
}
