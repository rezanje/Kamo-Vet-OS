"use client";

import { effectiveDateBounds } from "@/lib/purchase-backdate";

/**
 * Isian tanggal efektif pembatalan / dokumen pengganti pembelian (Accurate: dibukukan di tanggal aslinya).
 * Bawaan hari ini; rentang tanggal dokumen asal .. hari ini; tanpa izin Tanggal mundur isian dikunci ke hari ini.
 */
export function EffectiveDateField({ id, name = "tanggal", label = "Tanggal pembatalan", docDate, docLabel = "dokumen asal", canBackdate, disabled = false }: {
  id: string; name?: string; label?: string; docDate?: string | null; docLabel?: string; canBackdate: boolean; disabled?: boolean;
}) {
  const b = effectiveDateBounds({ docDate, canBackdate });
  return <>
    <label className="flab" htmlFor={id}>{label}</label>
    <input className="fi" id={id} name={name} type="date" defaultValue={b.value} min={b.min} max={b.max} required readOnly={b.locked} disabled={disabled} />
    <p data-testid="effective-date-hint" style={{ fontSize: 10.5, color: "var(--tm)", margin: "3px 0 0" }}>
      {b.locked
        ? "Dibukukan hari ini. Tanggal mundur hanya untuk Owner atau peran yang diberi izin Tanggal mundur di Akses Grup."
        : `Bawaan hari ini. Pilih tanggal ${docLabel}${docDate ? ` (${docDate})` : ""} agar jurnal, kartu stok, dan hutang terbaca di tanggal aslinya; tanggal mundur wajib beralasan, dan waktu sebenarnya tetap tersimpan di riwayat.`}
    </p>
  </>;
}
