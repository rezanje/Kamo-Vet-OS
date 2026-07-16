"use client";

import { useEffect } from "react";

// Auto-cetak sekali saat mount (dipakai untuk pembayaran tunai). rAF supaya struk sudah ter-render dulu.
export function AutoPrint() {
  useEffect(() => {
    const id = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(id);
  }, []);
  return null;
}

export function PrintButton({ label = "Cetak / Simpan PDF" }: { label?: string }) {
  return (
    <button onClick={() => window.print()} className="btn-acc no-print" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <i className="ti ti-printer" /> {label}
    </button>
  );
}
