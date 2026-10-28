"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

const TONES = {
  error: { color: "#b91c1c", border: "#fca5a5", icon: "ti-alert-circle", title: "Tidak dapat diproses" },
  success: { color: "#15803d", border: "#86efac", icon: "ti-circle-check", title: "Berhasil" },
};

// Native modal dialog: blocks the page until the user acknowledges the message.
export function Popup({ message, tone = "error", title, action, onClose }: {
  message?: string | null;
  tone?: keyof typeof TONES;
  title?: string;
  action?: { href: string; label: string; icon: string };
  onClose?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (message && !ref.current?.open) ref.current?.showModal();
  }, [message]);
  if (!message) return null;
  const t = TONES[tone];
  return <dialog ref={ref} role={tone === "error" ? "alertdialog" : "dialog"} aria-labelledby="popup-title" onClose={onClose} style={{ margin: "auto", border: `.5px solid ${t.border}`, borderRadius: 12, padding: 20, maxWidth: 420, width: "calc(100% - 32px)" }}>
    <div id="popup-title" style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700, color: t.color, marginBottom: 8 }}>
      <i className={`ti ${t.icon}`} style={{ fontSize: 20 }} /> {title ?? t.title}
    </div>
    <div style={{ fontSize: 13, color: "var(--sb)", marginBottom: 16 }}>{message}</div>
    <form method="dialog" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
      <button type="submit" className="btn-def" autoFocus={!action}>{action ? "Tutup" : "Mengerti"}</button>
      {action && <Link href={action.href} className="btn-acc" autoFocus style={{ display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none" }}>
        <i className={`ti ${action.icon}`} /> {action.label}
      </Link>}
    </form>
  </dialog>;
}
