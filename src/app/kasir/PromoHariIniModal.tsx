"use client";
import { useEffect, useMemo, useState } from "react";
import { AMBANG_CARI_PROMO, cariPromo, promoAturan, promoBerlaku, promoCabang, promoChip, type PromoChip, type PromoPopupRow } from "@/lib/promo-popup";

const WARNA: Record<PromoChip["tone"], { bg: string; fg: string }> = {
  paket: { bg: "#eff6ff", fg: "#1d4ed8" }, persen: { bg: "#f0fdf4", fg: "#15803d" }, rupiah: { bg: "#f0fdf4", fg: "#15803d" },
  gratis: { bg: "#fdf2f8", fg: "#be185d" }, bundling: { bg: "#faf5ff", fg: "#7e22ce" }, lain: { bg: "#f3f4f6", fg: "#4b5563" },
};

/** Daftar promo berjalan (referensi kasir, hanya baca). Panel tidak pernah lebih tinggi dari layar: header tetap, daftar bergulir sendiri. */
export function PromoHariIniModal({ promos, branchName, onClose }: { promos: readonly PromoPopupRow[]; branchName: string; onClose: () => void }) {
  const [kata, setKata] = useState("");
  const adaCari = promos.length > AMBANG_CARI_PROMO;
  const tampil = useMemo(() => cariPromo(promos, kata), [promos, kata]);

  useEffect(() => {
    const tutup = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", tutup);
    const sebelum = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // halaman di belakang tidak ikut bergulir
    return () => { document.removeEventListener("keydown", tutup); document.body.style.overflow = sebelum; };
  }, [onClose]);

  return (
    <div data-testid="promo-popup" role="dialog" aria-modal="true" aria-label={`Promo berjalan hari ini ${branchName}`}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12, boxSizing: "border-box" }}
      onClick={onClose}>
      <div data-testid="promo-popup-panel" onClick={(e) => e.stopPropagation()}
        style={{ width: "min(560px, 100%)", maxHeight: "min(86vh, 760px)", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}>
        <div style={{ flex: "none", background: "var(--posb)", color: "#fff", padding: "12px 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <i className="ti ti-speakerphone" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25 }}>Promo Berjalan Hari Ini</div>
            <div style={{ fontSize: 11, opacity: 0.9, overflowWrap: "anywhere" }}>{branchName} · {promos.length} promo</div>
          </div>
          <button type="button" aria-label="Tutup" data-testid="promo-popup-tutup" onClick={onClose}
            style={{ flex: "none", width: 36, height: 36, borderRadius: 8, border: 0, background: "rgba(255,255,255,.18)", color: "#fff", cursor: "pointer", fontSize: 18, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <i className="ti ti-x" />
          </button>
        </div>
        {adaCari && (
          <div style={{ flex: "none", padding: "8px 14px", borderBottom: ".5px solid var(--bd)", background: "#fff" }}>
            <input data-testid="promo-popup-cari" type="search" value={kata} onChange={(e) => setKata(e.target.value)} placeholder="Cari promo…" aria-label="Cari promo"
              style={{ width: "100%", boxSizing: "border-box", fontSize: 16, padding: "7px 10px", border: ".5px solid var(--bd)", borderRadius: 8 }} />
          </div>
        )}
        <div data-testid="promo-popup-list"
          style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", touchAction: "pan-y", padding: "6px 14px" }}>
          {promos.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--td)", textAlign: "center", padding: "24px 0" }}>Tidak ada promo aktif hari ini untuk cabang ini.</div>
          ) : tampil.length === 0 ? (
            <div data-testid="promo-popup-kosong" style={{ fontSize: 12, color: "var(--td)", textAlign: "center", padding: "24px 0" }}>Tidak ada promo yang cocok dengan “{kata.trim()}”.</div>
          ) : tampil.map((p) => {
            const chip = promoChip(p), w = WARNA[chip.tone], aturan = promoAturan(p), cabang = promoCabang(p);
            return (
              <div key={p.id} data-testid="promo-popup-item" style={{ padding: "10px 0", borderBottom: ".5px solid var(--bd)", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, lineHeight: 1.3, overflowWrap: "anywhere" }}>{p.name}</div>
                  <span style={{ flex: "none", background: w.bg, color: w.fg, borderRadius: 999, fontSize: 10, fontWeight: 700, padding: "2px 8px", whiteSpace: "nowrap" }}>{chip.label}</span>
                </div>
                {aturan && <div style={{ fontSize: 11.5, color: "var(--tm)", marginTop: 3, lineHeight: 1.4, overflowWrap: "anywhere" }}>{aturan}</div>}
                <div style={{ fontSize: 10.5, color: "var(--td)", marginTop: 3 }}>{promoBerlaku(p)}{cabang ? ` · ${cabang}` : ""}</div>
              </div>
            );
          })}
        </div>
        <div style={{ flex: "none", fontSize: 10.5, color: "var(--td)", padding: "8px 14px", borderTop: ".5px solid var(--bd)", background: "#fafafa" }}>
          Diset dari pusat untuk cabang ini. Tawarkan ke customer — terapkan manual via potongan item / diskon.
        </div>
      </div>
    </div>
  );
}
