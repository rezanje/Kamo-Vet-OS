"use client";

import type { NotificationRow } from "@/lib/notifications";
import { markNotifSeen, useNotifSeen } from "./notifSeen";

const TYPE_STYLE: Record<NotificationRow["type"], { icon: string; bg: string; fg: string }> = {
  promo: { icon: "ti-discount-2", bg: "#eff6ff", fg: "var(--posb)" },
  target: { icon: "ti-target-arrow", bg: "#fdf4ff", fg: "#a21caf" },
  system: { icon: "ti-info-circle", bg: "#f8fafc", fg: "#475569" },
};

export function NotifBanner({ notifications }: { notifications: NotificationRow[] }) {
  const seen = useNotifSeen();
  const next = notifications.find((n) => !seen.has(n.id));
  if (!next) return null;
  const style = TYPE_STYLE[next.type];

  return (
    <div className="no-print" style={{ background: style.bg, borderBottom: ".5px solid var(--bd)", padding: "8px 18px", display: "flex", alignItems: "center", gap: 10 }}>
      <i className={`ti ${style.icon}`} style={{ fontSize: 16, color: style.fg, flexShrink: 0 }} />
      <div style={{ fontSize: 12, flex: 1 }}>
        <span style={{ fontWeight: 700, color: style.fg }}>{next.title}</span>
        <span style={{ color: "var(--tm)" }}> — {next.message}</span>
      </div>
      <button
        type="button"
        onClick={() => markNotifSeen(next.id)}
        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--tm)", fontSize: 15, lineHeight: 1, flexShrink: 0 }}
        title="Tutup"
      >
        <i className="ti ti-x" />
      </button>
    </div>
  );
}
