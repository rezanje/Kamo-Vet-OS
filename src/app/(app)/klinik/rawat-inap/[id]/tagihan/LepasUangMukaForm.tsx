"use client";
import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { lepaskanUangMuka } from "./actions";

/**
 * Melepas pemakaian uang muka yang terlanjur menempel di tagihan.
 *
 * Tanpa ini, salah nominal/metode pada kwitansi yang uang mukanya sudah dipakai
 * terkunci selamanya: kwitansinya ditolak ADVANCE_USED, dan satu-satunya "jalan keluar"
 * yang tersisa adalah memulangkan pasien lalu merawatnya kembali — riwayat klinis palsu.
 * Peran, shift, alasan, dan jurnal pembaliknya diperiksa database.
 */
export function LepasUangMukaForm({
  recordId, advanceId, requestKey, nomor,
}: { recordId: string; advanceId: string; requestKey: string; nomor: string }) {
  const [buka, setBuka] = useState(false);
  if (!buka) {
    return (
      <button type="button" className="btn-def" style={{ padding: "3px 9px", fontSize: 10 }}
        onClick={() => setBuka(true)}>
        <i className="ti ti-arrow-back-up" /> Lepas pemakaian
      </button>
    );
  }
  return (
    <form action={lepaskanUangMuka} style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="recordId" value={recordId} />
      <input type="hidden" name="advanceId" value={advanceId} />
      <input type="hidden" name="requestKey" value={requestKey} />
      <input className="fi" name="reason" required maxLength={500}
        placeholder={`Alasan melepas ${nomor}`}
        aria-label={`Alasan melepas pemakaian uang muka ${nomor}`}
        style={{ fontSize: 10.5, padding: "3px 7px", minWidth: 190 }} />
      <SubmitButton className="btn-acc" style={{ padding: "3px 9px", fontSize: 10 }}
        pendingText="Melepas…">Lepas</SubmitButton>
    </form>
  );
}
