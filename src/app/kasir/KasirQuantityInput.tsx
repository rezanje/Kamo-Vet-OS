"use client";

import { useEffect, useRef, useState } from "react";

export function KasirQuantityInput({ quantity, label, onChange }: { quantity: number; label: string; onChange: (quantity: number) => void }) {
  // Temporary empty/invalid text must never become a zero/NaN checkout quantity.
  const [draft, setDraft] = useState<{ quantity: number; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const text = draft?.quantity === quantity ? draft.text : String(quantity);
  const parsed = Number(text);
  const valid = text.trim() !== "" && Number.isFinite(parsed) && parsed > 0 && parsed <= Number.MAX_SAFE_INTEGER;
  const message = valid ? "" : "Masukkan jumlah lebih dari 0 yang valid.";
  useEffect(() => { input.current?.setCustomValidity(message); }, [message]);

  return <input ref={input} type="number" inputMode="decimal" min={0} max={Number.MAX_SAFE_INTEGER} step="any" required
    className="fi" aria-label={label} aria-invalid={!valid || undefined} value={text}
    title="Ketik jumlah. Isian tidak valid kembali ke jumlah terakhir saat keluar."
    style={{ fontSize: 10.5, width: 58, minWidth: 0, padding: "3px 2px", textAlign: "center" }}
    onChange={event => {
      const raw = event.target.value;
      const next = Number(raw);
      const accepted = raw.trim() !== "" && Number.isFinite(next) && next > 0 && next <= Number.MAX_SAFE_INTEGER;
      event.target.setCustomValidity(accepted ? "" : "Masukkan jumlah lebih dari 0 yang valid.");
      setDraft({ quantity: accepted ? next : quantity, text: raw });
      if (accepted) onChange(next);
    }}
    onBlur={event => { event.currentTarget.setCustomValidity(""); setDraft(null); }}
    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />;
}
