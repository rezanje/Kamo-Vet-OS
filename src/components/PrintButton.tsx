"use client";

import { useEffect, useState } from "react";

// Auto-cetak sekali saat mount (dipakai untuk pembayaran tunai). rAF supaya struk sudah ter-render dulu.
export function AutoPrint() {
  useEffect(() => {
    const id = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(id);
  }, []);
  return null;
}

export function PrintButton({ label = "Cetak / Simpan PDF" }: { label?: string }) {
  const [printing, setPrinting] = useState(false);

  const mulaiCetak = () => {
    setPrinting(true);
    requestAnimationFrame(() => {
      window.print();
      window.setTimeout(() => setPrinting(false), 500);
    });
  };

  return (
    <>
      <button onClick={mulaiCetak} disabled={printing} aria-busy={printing} className="btn-acc no-print" style={{ display: "inline-flex", alignItems: "center", gap: 5, opacity: printing ? .8 : 1 }}>
        <i className={`ti ${printing ? "ti-loader-2" : "ti-printer"}`} style={printing ? { animation: "spin .8s linear infinite" } : undefined} /> {printing ? "Menyiapkan…" : label}
      </button>
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
    </>
  );
}
