"use client";
import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { batalkanKwitansi } from "./actions";

/** Kwitansi tidak pernah dihapus: dibalik, beralasan, dan tercatat siapa yang membatalkan. */
export function BatalKwitansiForm({
  recordId, receiptId, requestKey,
}: { recordId: string; receiptId: string; requestKey: string }) {
  const [buka, setBuka] = useState(false);
  if (!buka) {
    return (
      <button type="button" className="btn-def" style={{ padding: "3px 9px", fontSize: 10 }}
        onClick={() => setBuka(true)}>
        <i className="ti ti-receipt-off" /> Batalkan
      </button>
    );
  }
  return (
    <form action={batalkanKwitansi} style={{ display: "flex", gap: 5, alignItems: "center" }}>
      <input type="hidden" name="recordId" value={recordId} />
      <input type="hidden" name="receiptId" value={receiptId} />
      <input type="hidden" name="requestKey" value={requestKey} />
      <input className="fi" name="reason" required maxLength={500} placeholder="Alasan pembatalan"
        aria-label="Alasan pembatalan kwitansi" style={{ fontSize: 10.5, padding: "3px 7px", minWidth: 170 }} />
      <SubmitButton className="btn-acc" style={{ padding: "3px 9px", fontSize: 10, background: "#b91c1c" }}
        pendingText="Membatalkan…">Simpan</SubmitButton>
    </form>
  );
}
