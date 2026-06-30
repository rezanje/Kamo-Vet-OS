"use client";

export function PrintButton({ label = "Cetak / Simpan PDF" }: { label?: string }) {
  return (
    <button onClick={() => window.print()} className="btn-acc no-print" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <i className="ti ti-printer" /> {label}
    </button>
  );
}
