"use client";

import { useState } from "react";
import {
  ALASAN_MUNDUR_FIELD, bannerTanggalMundur, CATATAN_TANGGAL_MUNDUR, LABEL_ALASAN_TANGGAL, LABEL_TANGGAL_PEMBUKUAN, TANGGAL_MUNDUR_FIELD,
  type BatasMundurJual,
} from "@/lib/jual-tanggal-mundur";
import { hariIniWIB } from "@/lib/tanggal";

/**
 * Tanggal pembukuan penjualan petshop (kasir /kasir dan POS belakang). Bawaan hari ini (kolom kosong = hari ini = jalur biasa).
 * Peran tanpa hak tidak melihat apa pun tentang tanggal (batas null). Owner / peran berizin: satu kontrol kecil tertutup + banner yang
 * SELALU terlihat saat tanggal dipilih (supaya tidak lupa). Database tetap pemutus (izin, alasan, 31 hari, periode, gaji, bank).
 */
export function TanggalPembukuanJual({ batas, idPrefix, tanggalAwal = "", alasanAwal = "", hariIni = hariIniWIB() }: {
  batas: BatasMundurJual | null; idPrefix: string; tanggalAwal?: string; alasanAwal?: string; hariIni?: string;
}) {
  const [tanggal, setTanggal] = useState(tanggalAwal);
  const [alasan, setAlasan] = useState(alasanAwal);
  if (!batas || !batas.canBackdate) return null;
  const mundur = !!tanggal && tanggal < hariIni;
  return <div data-testid="tanggal-pembukuan-jual" style={{ margin: "6px 0" }}>
    <details open={!!tanggalAwal}>
      <summary style={{ cursor: "pointer", fontSize: 11 }}>{LABEL_TANGGAL_PEMBUKUAN}</summary>
      <label className="flab" htmlFor={`${idPrefix}-tanggal`}>Tanggal pembukuan</label>
      <input id={`${idPrefix}-tanggal`} className="fi" type="date" name={TANGGAL_MUNDUR_FIELD} min={batas.min} max={batas.max}
        value={tanggal} onChange={event => setTanggal(event.currentTarget.value)} />
      <p role="note" style={{ fontSize: 10.5, color: "var(--tm)", margin: "3px 0" }}>{CATATAN_TANGGAL_MUNDUR}</p>
      {mundur && <>
        <label className="flab" htmlFor={`${idPrefix}-alasan`}>{LABEL_ALASAN_TANGGAL}</label>
        <input id={`${idPrefix}-alasan`} className="fi" name={ALASAN_MUNDUR_FIELD} minLength={3} maxLength={200} required
          value={alasan} onChange={event => setAlasan(event.currentTarget.value)} placeholder="Contoh: barang lupa diinput kemarin" />
      </>}
      {tanggal && <button type="button" className="btn-ghost" style={{ marginTop: 4, fontSize: 10.5 }} onClick={() => { setTanggal(""); setAlasan(""); }}>Pakai hari ini</button>}
    </details>
    {mundur && <div role="status" data-testid="banner-tanggal-mundur" style={{ marginTop: 4, padding: "5px 8px", borderRadius: 6, background: "#fff7ed", border: ".5px solid #fdba74", color: "#9a3412", fontSize: 11, fontWeight: 600 }}>
      {bannerTanggalMundur(tanggal, hariIni)}
    </div>}
  </div>;
}
