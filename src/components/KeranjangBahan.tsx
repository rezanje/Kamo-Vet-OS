"use client";

import type { ReactNode } from "react";

/** Blok bahan/BMHP di bawah baris keranjang: diberi warna & garis kiri supaya mudah
 * dibedakan dari item utamanya (permintaan Andri 29 Okt — keranjang terlalu padat). */
const NADA = {
  bmhp: { latar: "#fffbeb", garis: "#d97706" },
  racikan: { latar: "#f0fdfa", garis: "#0d9488" },
} as const;

export function KeranjangBahan({ nada, judul, baris, kosong, children }: {
  nada: keyof typeof NADA; judul: string; baris: string[]; kosong?: string; children?: ReactNode;
}) {
  const { latar, garis } = NADA[nada];
  return <div data-bahan-blok={nada} style={{
    margin: "4px 0 2px 12px", padding: "4px 8px", background: latar,
    borderLeft: `3px solid ${garis}`, borderRadius: "0 6px 6px 0",
  }}>
    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".04em", color: garis }}>{judul}</div>
    {baris.map((teks, index) => <div key={index} style={{ fontSize: 9.5, color: "var(--tx)" }}>{teks}</div>)}
    {!baris.length && kosong && <div style={{ fontSize: 9.5, color: "var(--tm)" }}>{kosong}</div>}
    {children}
  </div>;
}
