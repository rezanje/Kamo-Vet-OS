"use client";

import { useState } from "react";
import { ajukanCutiPribadi } from "./actions";

export function CutiForm() {
  const [jenis, setJenis] = useState("Cuti");
  return (
    <form action={ajukanCutiPribadi} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      <div>
        <label className="flab">Jenis *</label>
        <select className="fi" name="jenis" value={jenis} onChange={(e) => setJenis(e.target.value)}>
          <option>Cuti</option><option>Izin</option><option>Sakit</option><option>Lembur</option>
        </select>
      </div>
      <div>
        <label className="flab">Durasi ({jenis === "Lembur" ? "jam" : "hari"})</label>
        <input className="fi" name="durasi" type="number" min={0} step="any" placeholder="0" />
      </div>
      <div>
        <label className="flab">Tanggal mulai *</label>
        <input className="fi" name="tanggal_mulai" type="date" required />
      </div>
      <div>
        <label className="flab">Tanggal selesai</label>
        <input className="fi" name="tanggal_selesai" type="date" />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label className="flab">Alasan</label>
        <input className="fi" name="alasan" placeholder="mis. acara keluarga" />
      </div>
      <button type="submit" className="btn-acc" style={{ gridColumn: "1 / -1", justifyContent: "center" }}>
        <i className="ti ti-send" /> Ajukan
      </button>
    </form>
  );
}
