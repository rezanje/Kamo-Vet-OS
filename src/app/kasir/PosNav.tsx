"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/kasir", label: "Kasir", icon: "ti-cash-register", exact: true },
  { href: "/kasir/pengeluaran", label: "Pengeluaran", icon: "ti-receipt-2", exact: false },
  { href: "/kasir/persediaan", label: "Persediaan", icon: "ti-stack", exact: false },
  { href: "/kasir/quest", label: "Quest", icon: "ti-trophy", exact: false },
];

export function PosNav({ branchName, userName, hasShift }: { branchName: string | null; userName: string; hasShift: boolean }) {
  const pathname = usePathname();

  return (
    <div className="pos-topbar no-print">
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Link href="/mulai" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none" }} title="Kembali ke pilihan mode">
          <div style={{ width: 34, height: 34, background: "#fff", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <i className="ti ti-paw" style={{ fontSize: 17, color: "var(--posb)" }} />
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: "#fff", lineHeight: 1.1, letterSpacing: ".01em" }}>KAMO PETSHOP</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,.65)" }}>Sistem POS Petshop {branchName ? `· ${branchName}` : ""}</div>
          </div>
        </Link>
        {hasShift && (
          <div style={{ display: "flex", gap: 4, marginLeft: 10 }}>
            {TABS.map((t) => {
              const on = t.exact ? pathname === t.href : pathname.startsWith(t.href);
              return (
                <Link key={t.href} href={t.href} className={`pos-tab ${on ? "on" : ""}`}>
                  <i className={`ti ${t.icon}`} style={{ fontSize: 14 }} /> {t.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 11.5, color: "rgba(255,255,255,.85)", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <i className="ti ti-calendar-event" style={{ fontSize: 14 }} />
          {new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
          {" | "}
          {new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
        </span>
        {hasShift && (
          <Link href="/kasir/tutup" className="pos-tab" style={{ border: "1px solid rgba(255,255,255,.35)" }}>
            <i className="ti ti-power" style={{ fontSize: 13 }} /> Selesai Shift
          </Link>
        )}
        <span style={{ fontSize: 11.5, color: "#fff", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 26, height: 26, borderRadius: "50%", background: "rgba(255,255,255,.2)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <i className="ti ti-user" style={{ fontSize: 14 }} />
          </span>
          {userName}
          <i className="ti ti-chevron-down" style={{ fontSize: 12, color: "rgba(255,255,255,.6)" }} />
        </span>
      </div>
    </div>
  );
}
