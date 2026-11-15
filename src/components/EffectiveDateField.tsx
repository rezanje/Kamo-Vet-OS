"use client";

import { effectiveDateBounds } from "@/lib/purchase-backdate";
import { UBAH_TANGGAL_CATATAN, UBAH_TANGGAL_LABEL } from "@/lib/tanggal-pembukuan-copy";

/**
 * Tanggal pembukuan pembatalan / dokumen pengganti pembelian. Bawaan hari ini.
 * Tanpa hak memilih tanggal lain: tidak menampilkan apa pun tentang tanggal (hanya mengirim hari ini, sama seperti sebelumnya).
 * Owner / peran berizin: satu kontrol kecil tertutup; database tetap pemutus (rentang, periode, alasan).
 */
export function EffectiveDateField({ id, name = "tanggal", label = "Tanggal pembukuan", docDate, canBackdate, disabled = false }: {
  id: string; name?: string; label?: string; docDate?: string | null; docLabel?: string; canBackdate: boolean; disabled?: boolean;
}) {
  const b = effectiveDateBounds({ docDate, canBackdate });
  if (b.locked) return disabled ? null : <input type="hidden" name={name} value={b.value} />;
  return <details data-testid="effective-date-control" style={{ margin: "6px 0" }}>
    <summary style={{ cursor: "pointer", fontSize: 11 }}>{UBAH_TANGGAL_LABEL}</summary>
    <label className="flab" htmlFor={id}>{label}</label>
    <input className="fi" id={id} name={name} type="date" defaultValue={b.value} min={b.min} max={b.max} required disabled={disabled} />
    <p data-testid="effective-date-hint" style={{ fontSize: 10.5, color: "var(--tm)", margin: "3px 0 0" }}>{UBAH_TANGGAL_CATATAN}</p>
  </details>;
}
