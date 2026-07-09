"use client";

import { useState } from "react";

export type LogDetail = {
  tanggal: string; waktu: string;
  condition_note: string; tindakan: string | null; keterangan: string | null; doctor_name: string | null;
};

export function LogDetailButton({ log }: { log: LogDetail }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Lihat detail"
        style={{ display: "inline-flex", width: 26, height: 26, borderRadius: 6, border: "1px solid #bfdbfe", color: "#2563eb", background: "#fff", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
        <i className="ti ti-eye" />
      </button>

      {open && (
        <div onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 12, padding: 20, width: "100%", maxWidth: 420, boxShadow: "0 10px 40px rgba(0,0,0,.2)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--sb)" }}>
                <i className="ti ti-clipboard-text" style={{ color: "#2563eb" }} /> Catatan {log.tanggal} · {log.waktu}
              </div>
              <button type="button" onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--tm)", fontSize: 16 }}>
                <i className="ti ti-x" />
              </button>
            </div>
            <Row label="Kondisi pasien" value={log.condition_note} />
            <Row label="Tindakan / perawatan" value={log.tindakan} />
            <Row label="Keterangan" value={log.keterangan} />
            <Row label="Oleh dokter" value={log.doctor_name} />
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "var(--tm)", fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12.5, color: "var(--tx)", whiteSpace: "pre-wrap" }}>{value || "—"}</div>
    </div>
  );
}
