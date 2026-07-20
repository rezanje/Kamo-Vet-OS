"use client";

import { tutupShiftKasir } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";

// Kasir buta: hanya input kas fisik, tanpa perbandingan selisih (spec 2026-07-17).
export function TutupForm({ shiftId }: { shiftId: string }) {
  return (
    <form action={tutupShiftKasir}>
      <input type="hidden" name="shiftId" value={shiftId} />
      <label className="flab">Total uang cash di kasir (fisik) *</label>
      <div className="pshop-rp" style={{ marginBottom: 12 }}>
        <span>Rp</span>
        <input
          className="fi" name="closing_balance" type="number" min={0} step={500}
          placeholder="0" required
        />
      </div>
      <SubmitButton className="kpos-bayar" icon="ti-lock" pendingText="Menutup shift…">TUTUP SHIFT</SubmitButton>
    </form>
  );
}
