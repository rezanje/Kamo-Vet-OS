"use client";

import { useState } from "react";
import type { NotificationRow } from "@/lib/notifications";
import { markAllNotifSeen, useNotifSeen } from "./notifSeen";

const TYPE_LABEL: Record<NotificationRow["type"], string> = {
  promo: "Promo", target: "Target", system: "Info",
};

export function NotifBell({ notifications }: { notifications: NotificationRow[] }) {
  const [open, setOpen] = useState(false);
  const seen = useNotifSeen();
  const unread = notifications.filter((n) => !seen.has(n.id)).length;

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && unread > 0) markAllNotifSeen(notifications.map((n) => n.id));
        }}
        style={{ position: "relative", background: "none", border: "none", cursor: "pointer", color: "#fff", padding: 4, display: "flex" }}
        title="Notifikasi"
      >
        <i className="ti ti-bell" style={{ fontSize: 18 }} />
        {unread > 0 && (
          <span style={{ position: "absolute", top: -2, right: -2, background: "#dc2626", color: "#fff", fontSize: 9.5, fontWeight: 700, borderRadius: "50%", minWidth: 15, height: 15, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", width: 300, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.18)", zIndex: 41, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: ".5px solid var(--bd)", fontSize: 12, fontWeight: 700, color: "var(--tx)" }}>
              Notifikasi dari Pusat
            </div>
            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {notifications.length === 0 ? (
                <div style={{ padding: 16, fontSize: 11.5, color: "var(--tm)", textAlign: "center" }}>Tidak ada notifikasi.</div>
              ) : (
                notifications.map((n) => (
                  <div key={n.id} style={{ padding: "10px 14px", borderBottom: ".5px solid var(--bd)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--posb)", background: "#eff6ff", borderRadius: 4, padding: "1px 6px" }}>
                        {TYPE_LABEL[n.type]}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--tx)" }}>{n.title}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--tm)" }}>{n.message}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
