"use client";

import { useState } from "react";
import { batasKolom, type BatasTanggal } from "@/lib/tanggal-efektif-petshop";
import { ALASAN_UBAH_TANGGAL_LABEL, UBAH_TANGGAL_CATATAN, UBAH_TANGGAL_LABEL } from "@/lib/tanggal-pembukuan-copy";

/**
 * Tanggal pembukuan jurnal pembalik / terima ulang / pembalikan pencairan. Bawaan hari ini.
 * Peran yang tidak boleh memilih tanggal lain tidak melihat apa pun tentang tanggal (kolom tidak dikirim -> server memakai hari ini).
 * Owner / peran berizin: satu kontrol kecil tertutup; database tetap pemutus.
 */
export function TanggalEfektifField({ batas, idPrefix, alasanWajibMundur = false }: {
  batas: BatasTanggal; idPrefix: string; alasanWajibMundur?: boolean; jenis?: "batal" | "terima" | "pencairan";
}) {
  const kolom = batasKolom(batas);
  const [nilai, setNilai] = useState(kolom.max);
  const berubah = !!nilai && nilai < kolom.max;
  if (!batas.canBackdate) return null;
  return <details data-testid="tanggal-efektif" style={{ margin: "6px 0" }}>
    <summary style={{ cursor: "pointer", fontSize: 11 }}>{UBAH_TANGGAL_LABEL}</summary>
    <label className="flab" htmlFor={`${idPrefix}-tanggal`}>Tanggal pembukuan</label>
    <input id={`${idPrefix}-tanggal`} className="fi" type="date" name="tanggal" min={kolom.min} max={kolom.max} value={nilai}
      onChange={event => setNilai(event.currentTarget.value)} />
    <p role="note" style={{ fontSize: 11, color: "var(--tm)" }}>{UBAH_TANGGAL_CATATAN}</p>
    {alasanWajibMundur && berubah && <>
      <label className="flab" htmlFor={`${idPrefix}-alasan-tanggal`}>{ALASAN_UBAH_TANGGAL_LABEL}</label>
      <input id={`${idPrefix}-alasan-tanggal`} className="fi" name="alasan" minLength={3} maxLength={1000} required placeholder="Contoh: dibayar di hari struk, salah catat metode" />
    </>}
  </details>;
}
