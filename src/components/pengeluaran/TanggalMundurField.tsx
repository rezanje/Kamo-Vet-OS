"use client";

import { useEffect, useRef, useState } from "react";
import { ALASAN_MAX, ALASAN_MIN, BATAS_HARI_MUNDUR, batasTanggalMundur, formatTanggalID, pesanDicatatDi } from "@/lib/tanggal-mundur";

/**
 * Tanggal pengeluaran: default HARI INI (tidak berubah untuk pemakaian biasa). Bagian tertutup "Tanggal mundur (opsional)" tersedia untuk
 * SEMUA akun yang boleh input pengeluaran (keputusan Owner / Andri 23 Nov 2026): tanggal paling lama 31 hari ke belakang + alasan wajib.
 * Kolom `tanggal` dan `alasan_tanggal` memakai nama form biasa (ikut draf peramban lewat vetos:draft-restore).
 */
export function TanggalMundurField({ today, konteks }: { today: string; konteks: "backoffice" | "cashier" | "clinic" }) {
  const [tanggal, setTanggal] = useState(today);
  const [dibuka, setDibuka] = useState(false);
  const kolom = useRef<HTMLDivElement>(null);
  const mundur = tanggal < today;
  const min = batasTanggalMundur(today);

  // Pemulihan draf mengisi nilai langsung ke kolom; sinkronkan tampilan (bagian terbuka + banner).
  useEffect(() => {
    const el = kolom.current?.querySelector<HTMLInputElement>('input[name="tanggal"]');
    if (!el) return;
    const sync = (event: Event) => {
      const nilai = String((event as CustomEvent<string>).detail ?? el.value ?? "");
      setTanggal(/^\d{4}-\d{2}-\d{2}$/.test(nilai) ? nilai : today);
    };
    el.addEventListener("vetos:draft-restore", sync);
    return () => el.removeEventListener("vetos:draft-restore", sync);
  }, [today]);

  return (
    <div ref={kolom} data-testid="tanggal-mundur">
      <label className="flab">Tanggal pengeluaran</label>
      <div className="fi" style={{ display: "flex", alignItems: "center", background: "var(--sf1)" }} data-testid="tanggal-tercatat">
        {mundur ? <b>{formatTanggalID(tanggal)}</b> : <span>Hari ini ({formatTanggalID(today)})</span>}
      </div>
      <details open={dibuka || mundur} onToggle={(event) => setDibuka((event.currentTarget as HTMLDetailsElement).open)} style={{ marginTop: 6 }}>
        <summary style={{ cursor: "pointer", fontSize: 11.5, color: "var(--acc)" }}>Tanggal mundur (opsional)</summary>
        <div style={{ marginTop: 8 }}>
          <label className="flab" htmlFor="pengeluaran-tanggal">Catat di tanggal</label>
          <input
            id="pengeluaran-tanggal" className="fi" name="tanggal" type="date" min={min} max={today} defaultValue={today} data-draft-state
            onChange={(event) => setTanggal(event.target.value || today)}
          />
          <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 3 }}>
            Paling lama {BATAS_HARI_MUNDUR} hari ke belakang (mulai {formatTanggalID(min)}). Tanggal yang periodenya sudah ditutup buku atau rekeningnya sudah direkonsiliasi bank ditolak.
          </div>
          <div style={{ marginTop: 8, display: mundur ? "block" : "none" }}>
            <label className="flab" htmlFor="pengeluaran-alasan-tanggal">Alasan tanggal mundur *</label>
            <input
              id="pengeluaran-alasan-tanggal" className="fi" name="alasan_tanggal" type="text" maxLength={ALASAN_MAX} minLength={ALASAN_MIN}
              required={mundur} disabled={!mundur} placeholder="mis. nota terlupa diinput kemarin"
            />
            <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 3 }}>Wajib {ALASAN_MIN}-{ALASAN_MAX} huruf atau angka. Tercatat bersama nama dan waktu input Anda dan tidak dapat diubah.</div>
          </div>
        </div>
      </details>
      {mundur && (
        <div role="status" className="p2ban" style={{ marginTop: 8 }} data-testid="banner-tanggal-mundur">
          <b>{pesanDicatatDi(tanggal, today)}</b>
          {konteks === "backoffice"
            ? " Jurnal dan laporan memakai tanggal itu; pengeluaran ini tidak memakai laci kasir."
            : " Pengeluaran Tunai mengurangi laci shift Anda yang terbuka SEKARANG (hitungan kas shift ini berkurang); jurnal dan laporan memakai tanggal itu. Bila uangnya sebenarnya sudah keluar dari laci pada hari itu, tutup shift hari ini akan tampak lebih besar sebesar jumlah ini: tulis di alasan dan beri tahu Finance."}
        </div>
      )}
    </div>
  );
}
