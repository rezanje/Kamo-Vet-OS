"use client";

import { useEffect, useRef } from "react";

// Native modal dialog: blocks the page until the user acknowledges the error.
export function ErrorPopup({ message }: { message?: string | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (message && !ref.current?.open) ref.current?.showModal();
  }, [message]);
  if (!message) return null;
  return <dialog ref={ref} role="alertdialog" aria-labelledby="error-popup-title" style={{ border: ".5px solid #fca5a5", borderRadius: 12, padding: 20, maxWidth: 420, width: "calc(100% - 32px)" }}>
    <div id="error-popup-title" style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700, color: "#b91c1c", marginBottom: 8 }}>
      <i className="ti ti-alert-circle" style={{ fontSize: 20 }} /> Tidak dapat diproses
    </div>
    <div style={{ fontSize: 13, color: "var(--sb)", marginBottom: 16 }}>{message}</div>
    <form method="dialog" style={{ display: "flex", justifyContent: "flex-end" }}>
      <button type="submit" className="btn-def" autoFocus>Mengerti</button>
    </form>
  </dialog>;
}
