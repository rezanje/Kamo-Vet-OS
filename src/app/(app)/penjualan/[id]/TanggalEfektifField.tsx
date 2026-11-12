"use client";

import { useState } from "react";
import { batasKolom, tanggalId, type BatasTanggal } from "@/lib/tanggal-efektif-petshop";

/**
 * Tanggal efektif (backdate) gaya Accurate: tanggal pembukuan jurnal pembalik / terima ulang / pembalikan pencairan.
 * Bawaan hari ini. Sebelum hari ini hanya Owner (atau peran yang dicentang Owner); database tetap pemutus.
 * Kolom tidak dikirim bila peran tidak boleh mundur -> server memakai hari ini.
 */
export function TanggalEfektifField({ batas, idPrefix, alasanWajibMundur = false, jenis }: {
  batas: BatasTanggal; idPrefix: string; alasanWajibMundur?: boolean; jenis: "batal" | "terima" | "pencairan";
}) {
  const kolom = batasKolom(batas);
  const [nilai, setNilai] = useState(kolom.max);
  const mundur = !!nilai && nilai < kolom.max;
  const kata = jenis === "batal" ? "jurnal pembalik" : jenis === "terima" ? "jurnal terima ulang" : "jurnal pembalik pencairan";
  if (!batas.canBackdate) {
    return <p role="note" data-testid="tanggal-efektif-hanya-hari-ini">
      <strong>Tanggal efektif:</strong> hari ini ({tanggalId(kolom.max)}). Tanggal sebelum hari ini hanya untuk Owner, atau peran yang diberi izin <em>Tanggal mundur</em> oleh Owner di Pengaturan &gt; Akses Grup.
    </p>;
  }
  return <div data-testid="tanggal-efektif">
    <label className="flab" htmlFor={`${idPrefix}-tanggal`}>Tanggal efektif (tanggal pembukuan)</label>
    <input id={`${idPrefix}-tanggal`} className="fi" type="date" name="tanggal" min={kolom.min} max={kolom.max} value={nilai}
      onChange={event => setNilai(event.currentTarget.value)} />
    <p role="note" style={{ fontSize: 11, color: "var(--tm)" }}>
      Bawaan hari ini. Pilih tanggal asli bila ingin {kata} dibukukan di hari kejadian (rentang {tanggalId(kolom.min)} sampai {tanggalId(kolom.max)}; tidak boleh di masa depan).
    </p>
    {batas.closedUntil && <p role="note" style={{ fontSize: 11 }}>Periode akuntansi sudah ditutup sampai {tanggalId(batas.closedUntil)}. Tanggal sampai batas itu ditolak; buka kembali periodenya lewat Tutup Buku bila perlu.</p>}
    {mundur && <p role="status" data-testid="tanggal-efektif-mundur">
      {jenis === "terima" ? "Penerimaan" : jenis === "batal" ? "Pembatalan" : "Pembalikan"} dibukukan di tanggal <strong>{tanggalId(nilai)}</strong>, bukan hari ini. Struk dan laporan penjualan tanggal struk tidak berubah;
      Kas/Bank, Buku Besar, dan Arus Kas tanggal itu ikut. Uang di laci tetap tercatat di shift Anda yang sedang terbuka (atau ditandai &quot;tanpa shift&quot;).
    </p>}
    {alasanWajibMundur && mundur && <>
      <label className="flab" htmlFor={`${idPrefix}-alasan-tanggal`}>Alasan tanggal mundur *</label>
      <input id={`${idPrefix}-alasan-tanggal`} className="fi" name="alasan" minLength={3} maxLength={1000} required placeholder="Contoh: dibayar di hari struk, salah catat metode" />
    </>}
  </div>;
}
