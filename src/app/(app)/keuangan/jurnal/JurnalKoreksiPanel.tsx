"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { JurnalCorrectionForm } from "./JurnalCorrectionForm";

// Permintaan klinik (Mba Anisa, 27 Nov 2026): form koreksi jurnal manual dulu dibuka DI DALAM
// kolom Tindakan (245px), jadi kolom akunnya tinggal beberapa huruf. Sekarang tombolnya tetap
// di kolom Tindakan, tapi formnya terbuka selebar tabel, tepat di bawah baris jurnalnya.
// Tombol dan panel berada di <tr> berbeda — status terbukanya dibagi lewat context ini.

type Buka = { terbuka: ReadonlySet<string>; alih: (entryId: string) => void };
const KoreksiCtx = createContext<Buka | null>(null);
const idPanel = (entryId: string) => `koreksi-jurnal-${entryId}`;

export function JurnalKoreksiProvider({ children }: { children: ReactNode }) {
  const [terbuka, setTerbuka] = useState<ReadonlySet<string>>(() => new Set());
  const alih = useCallback((entryId: string) => setTerbuka((lama) => {
    const baru = new Set(lama);
    if (!baru.delete(entryId)) baru.add(entryId);
    return baru;
  }), []);
  const nilai = useMemo(() => ({ terbuka, alih }), [terbuka, alih]);
  return <KoreksiCtx.Provider value={nilai}>{children}</KoreksiCtx.Provider>;
}

/** Tombol di kolom Tindakan. */
export function JurnalKoreksiTombol({ entryId }: { entryId: string }) {
  const ctx = useContext(KoreksiCtx);
  const buka = ctx?.terbuka.has(entryId) ?? false;
  return (
    <button type="button" aria-expanded={buka} aria-controls={idPanel(entryId)} onClick={() => ctx?.alih(entryId)}
      style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "#2563eb", fontSize: 10.5, whiteSpace: "nowrap" }}>
      <i className={`ti ti-chevron-${buka ? "down" : "right"}`} style={{ fontSize: 11, verticalAlign: "-1px" }} /> Edit jurnal manual
    </button>
  );
}

/** Baris selebar tabel berisi form koreksi. Tetap terpasang saat tertutup (seperti <details> dulu)
 *  supaya isian yang sedang diketik dan pembersihan draf setelah simpan tidak berubah perilakunya. */
export function JurnalKoreksiBaris({ colSpan, noJurnal, ...form }: { colSpan: number; noJurnal: string } & ComponentProps<typeof JurnalCorrectionForm>) {
  const ctx = useContext(KoreksiCtx);
  const buka = ctx?.terbuka.has(form.entryId) ?? false;
  const baris = useRef<HTMLTableRowElement>(null);
  useEffect(() => { if (buka) baris.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }, [buka]);
  return (
    <tr ref={baris} id={idPanel(form.entryId)} hidden={!buka} data-testid="jurnal-koreksi-baris">
      <td colSpan={colSpan} style={{ background: "var(--sf1)", padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Edit jurnal manual · <span style={{ fontFamily: "monospace" }}>{noJurnal}</span></span>
          <button type="button" className="back-btn" style={{ fontSize: 12 }} onClick={() => ctx?.alih(form.entryId)}>
            <i className="ti ti-x" /> Tutup
          </button>
        </div>
        <JurnalCorrectionForm {...form} />
      </td>
    </tr>
  );
}
