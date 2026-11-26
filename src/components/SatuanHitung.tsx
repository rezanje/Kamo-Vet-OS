"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { fmtJumlah } from "@/lib/opname-jumlah-tak-wajar";

/** Satuan besar dan tebal di samping kolom isian jumlah fisik (hitung stok opname). */
export function SatuanBesar({ unit }: { unit: string }) {
  const nama = unit.trim();
  if (!nama) {
    return <span data-satuan-besar="kosong" aria-label="Satuan belum diisi"
      style={{ fontSize: 12, fontWeight: 700, color: "#b45309", whiteSpace: "nowrap" }}>satuan?</span>;
  }
  return <span data-satuan-besar="ada"
    style={{
      fontSize: 16, fontWeight: 800, color: "#1e3a8a", background: "#dbeafe", border: "1.5px solid #93c5fd",
      borderRadius: 8, padding: "3px 10px", whiteSpace: "nowrap", lineHeight: 1.3,
    }}>{nama}</span>;
}

/** Kalimat di atas kolom isian: "Isi jumlah fisik dalam LITER" (satuan ditebalkan). */
export function PetunjukSatuan({ unit, htmlFor }: { unit: string; htmlFor?: string }) {
  const nama = unit.trim();
  return <label htmlFor={htmlFor} data-petunjuk-satuan style={{ fontSize: 10.5, color: "var(--tm)", whiteSpace: "nowrap" }}>
    Isi jumlah fisik dalam {nama ? <strong style={{ color: "#1e3a8a", fontSize: 11.5 }}>{nama}</strong> : <strong>satuan barang</strong>}
  </label>;
}

export type ButirKonfirmasi = { id: string; nama: string; jumlah: number; satuan: string; sistem?: number | null };

/**
 * Konfirmasi jumlah janggal sebelum menyimpan. Satu dialog memuat semua barang yang ditandai, jadi cukup SATU kali
 * konfirmasi untuk semuanya. Bisa lewat papan ketik: fokus awal di "Periksa lagi" (aksi aman), Esc = periksa lagi,
 * Tab berputar di dalam dialog. `sistem` hanya diisi di layar yang memang menampilkan stok sistem.
 */
export function KonfirmasiJumlah({ butir, onYa, onBatal }: { butir: ButirKonfirmasi[]; onYa: () => void; onBatal: () => void }) {
  const batal = useRef<HTMLButtonElement>(null);
  const ya = useRef<HTMLButtonElement>(null);
  const sebelum = useRef<Element | null>(null);

  useEffect(() => {
    sebelum.current = document.activeElement;
    batal.current?.focus();
    const awal = sebelum.current;
    return () => { if (awal instanceof HTMLElement && awal.isConnected) awal.focus(); };
  }, []);

  const tekan = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onBatal(); return; }
    if (e.key !== "Tab") return;
    const urutan = [batal.current, ya.current].filter((x): x is HTMLButtonElement => !!x);
    const i = urutan.indexOf(document.activeElement as HTMLButtonElement);
    const berikut = e.shiftKey ? urutan[(i <= 0 ? urutan.length : i) - 1] : urutan[(i + 1) % urutan.length];
    e.preventDefault(); berikut?.focus();
  };

  const satu = butir.length === 1 ? butir[0] : null;
  const judul = satu
    ? `Yakin ${fmtJumlah(satu.jumlah)} ${satu.satuan.trim() || "satuan"}?${satu.sistem != null ? ` Sistem ${fmtJumlah(satu.sistem)} ${satu.satuan.trim() || "satuan"}` : ""}`
    : `Yakin dengan ${butir.length} jumlah ini?`;

  return (
    <div data-konfirmasi-jumlah style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="konfirmasi-jumlah-judul" aria-describedby="konfirmasi-jumlah-isi" onKeyDown={tekan}
        style={{ background: "#fff", borderRadius: 12, border: "2px solid #f59e0b", maxWidth: 520, width: "100%", maxHeight: "85vh", overflowY: "auto", padding: 16, boxShadow: "0 10px 40px rgba(0,0,0,.35)" }}>
        <div id="konfirmasi-jumlah-judul" style={{ fontSize: 17, fontWeight: 800, color: "#b45309", marginBottom: 6 }}>
          <i className="ti ti-alert-triangle" /> {judul}
        </div>
        <div id="konfirmasi-jumlah-isi" style={{ fontSize: 12, marginBottom: 10 }}>
          {butir.every((b) => b.sistem != null)
            ? "Jumlah ini jauh berbeda dari stok sistem. Periksa lagi satuannya sebelum disimpan."
            : "Jumlah ini jauh lebih besar dari stok sistem. Periksa lagi satuannya (jangan sampai salah angka atau salah satuan) sebelum disimpan."}
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
          {butir.map((b) => (
            <li key={b.id} data-butir-janggal={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "#fffbeb", border: ".5px solid #fcd34d", borderRadius: 8, padding: "6px 10px" }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{b.nama}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                <strong style={{ fontSize: 18 }}>{fmtJumlah(b.jumlah)}</strong>
                <SatuanBesar unit={b.satuan} />
                {b.sistem != null && <span style={{ fontSize: 11, color: "var(--tm)" }}>Sistem {fmtJumlah(b.sistem)} {b.satuan.trim()}</span>}
              </span>
            </li>
          ))}
        </ul>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button ref={batal} type="button" className="btn-def" onClick={onBatal} style={{ padding: "8px 14px", fontWeight: 700 }}>
            Periksa lagi
          </button>
          <button ref={ya} type="button" className="btn-acc" onClick={onYa} style={{ padding: "8px 14px" }}>
            {butir.length === 1 ? "Ya, jumlah ini benar" : "Ya, semua benar"}
          </button>
        </div>
      </div>
    </div>
  );
}
