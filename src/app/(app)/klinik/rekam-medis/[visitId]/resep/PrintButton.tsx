"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="btn-acc no-print" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <i className="ti ti-printer" /> Cetak / Simpan PDF
    </button>
  );
}
