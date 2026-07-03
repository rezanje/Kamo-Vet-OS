"use client";

import { useState } from "react";
import { tutupShiftKasir } from "../actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Selisih dihitung real-time saat kasir mengetik uang fisik (Addendum §1 UI req).
export function TutupForm({ shiftId, expected }: { shiftId: string; expected: number }) {
  const [actual, setActual] = useState<string>("");
  const num = Number(actual) || 0;
  const selisih = num - expected;
  const touched = actual !== "";

  return (
    <form action={tutupShiftKasir}>
      <input type="hidden" name="shiftId" value={shiftId} />
      <label className="flab">Total uang cash di kasir (fisik) *</label>
      <input
        className="fi" name="closing_balance" type="number" min={0} step={500}
        placeholder="Hitung uang di laci" required value={actual}
        onChange={(e) => setActual(e.target.value)} style={{ marginBottom: 8 }}
      />
      {touched && (
        <div
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "8px 11px", borderRadius: 8, marginBottom: 10,
            background: selisih === 0 ? "#e8f5ee" : selisih > 0 ? "#eff6ff" : "#fef2f2",
            border: `.5px solid ${selisih === 0 ? "#86efac" : selisih > 0 ? "#93c5fd" : "#fca5a5"}`,
          }}
        >
          <span style={{ fontSize: 11.5, fontWeight: 600 }}>
            {selisih === 0 ? "Kas sesuai" : selisih > 0 ? "Kas lebih" : "Kas kurang"}
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: selisih === 0 ? "#15803d" : selisih > 0 ? "#1d4ed8" : "#b91c1c" }}>
            {selisih > 0 ? "+" : ""}{rp(selisih)}
          </span>
        </div>
      )}
      <div style={{ fontSize: 9.5, color: "var(--td)", marginBottom: 12 }}>
        Selisih ≠ 0 tetap bisa tutup shift — tercatat & dilaporkan ke manajer cabang (bukan diblokir).
      </div>
      <button type="submit" className="pay-btn"><i className="ti ti-lock" /> Tutup Shift & Lihat Laporan</button>
    </form>
  );
}
