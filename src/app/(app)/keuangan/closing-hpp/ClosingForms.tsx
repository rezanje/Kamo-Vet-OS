"use client";

import { useFormStatus } from "react-dom";
import { activateAverage, closeInventoryMonth } from "./actions";

function Submit({ children, disabled = false }: { children: React.ReactNode; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn-acc" disabled={disabled || pending}>{pending ? "Memproses…" : children}</button>;
}

export function ActivationForm({ disabled }: { disabled: boolean }) {
  return <form action={activateAverage}><Submit disabled={disabled}>Aktifkan rata-rata bergerak</Submit></form>;
}

export function ClosingForm({ month, disabled }: { month: string; disabled: boolean }) {
  return <form action={closeInventoryMonth} style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
    <div><label htmlFor="closing-month" className="flab">Bulan closing</label><input id="closing-month" className="fi" type="month" name="month" defaultValue={month} max={month} required disabled={disabled} /></div>
    <Submit disabled={disabled}>Simpan snapshot & kunci bulan</Submit>
  </form>;
}
