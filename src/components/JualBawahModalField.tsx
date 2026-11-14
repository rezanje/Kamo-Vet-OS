"use client";

import { ALASAN_BAWAH_MODAL, ALASAN_MAKS, ALASAN_MIN, alasanDariPilihan } from "@/lib/jual-bawah-modal";

export type BawahModalPatch = { bawah_modal_pilih?: string; bawah_modal_teks?: string; bawah_modal_alasan?: string };

/** Baris keranjang: sudah mencentang tetapi alasan belum sah (membuat tombol Bayar nonaktif). */
export function bawahModalBelumSah(line: { bawah_modal_pilih?: string; bawah_modal_alasan?: string }): boolean {
  return !!line.bawah_modal_pilih && !line.bawah_modal_alasan;
}

/**
 * Centang "Jual di bawah modal (obral)" per baris barang persediaan — tampil hanya untuk Owner/peran berizin (hak dibaca dari database oleh halaman).
 * Alasan wajib: pilihan (Mau kadaluarsa, Rusak kemasan, Cuci gudang) atau "Lainnya" + teks 3-200 huruf. Server dan database memeriksa ulang.
 */
export function JualBawahModalField({ nama, pilih, teks, onChange }: {
  nama: string; pilih?: string; teks?: string; onChange: (patch: BawahModalPatch) => void;
}) {
  const aktif = !!pilih;
  const ubah = (p: string | undefined, t: string | undefined) => onChange({ bawah_modal_pilih: p || undefined, bawah_modal_teks: t || undefined, bawah_modal_alasan: alasanDariPilihan(p, t) || undefined });
  return (
    <div style={{ marginTop: 3, padding: "3px 5px", border: aktif ? ".5px solid #b45309" : ".5px dashed var(--bd)", borderRadius: 4, background: aktif ? "#fffbeb" : "transparent" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9.5, cursor: "pointer" }}>
        <input type="checkbox" checked={aktif} aria-label={`Jual di bawah modal ${nama}`}
          onChange={(e) => (e.target.checked ? ubah("Mau kadaluarsa", "") : ubah(undefined, undefined))} />
        <span style={{ fontWeight: 600 }}>Jual di bawah modal (obral)</span>
      </label>
      {aktif && (
        <div style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
          <select className="fi" value={pilih} aria-label={`Alasan jual di bawah modal ${nama}`} style={{ padding: "1px 4px", fontSize: 9.5 }}
            onChange={(e) => ubah(e.target.value, teks)}>
            {ALASAN_BAWAH_MODAL.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {pilih === "Lainnya" && (
            <input className="fi" type="text" value={teks ?? ""} maxLength={ALASAN_MAKS} placeholder={`Alasan (min ${ALASAN_MIN} huruf)`}
              aria-label={`Tulis alasan ${nama}`} style={{ padding: "1px 4px", fontSize: 9.5, minWidth: 110 }}
              onChange={(e) => ubah("Lainnya", e.target.value)} />
          )}
        </div>
      )}
      {aktif && !alasanDariPilihan(pilih, teks) && <div style={{ fontSize: 8.8, color: "#b91c1c", marginTop: 2 }}>Isi alasan dulu ({ALASAN_MIN}-{ALASAN_MAKS} huruf).</div>}
    </div>
  );
}
