"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/kasir", label: "Kasir", icon: "ti-cash-register", exact: true },
  { href: "/kasir/pengeluaran", label: "Pengeluaran", icon: "ti-receipt-2", exact: false },
  { href: "/kasir/persediaan", label: "Persediaan", icon: "ti-stack", exact: false },
];

export function PosNav({ branchName, userName, hasShift }: { branchName: string | null; userName: string; hasShift: boolean }) {
  const pathname = usePathname();

  return (
    <div className="pos-topbar no-print">
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Link href="/mulai" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }} title="Kembali ke pilihan mode">
          <div style={{ width: 30, height: 30, background: "var(--acc)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="ti ti-paw" style={{ fontSize: 16, color: "#fff" }} />
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>KAMO PETSHOP</div>
            <div style={{ fontSize: 8.5, color: "rgba(255,255,255,.5)" }}>Sistem POS {branchName ? `· ${branchName}` : ""}</div>
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

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <i className="ti ti-bell" style={{ fontSize: 16, color: "rgba(255,255,255,.6)" }} title="Notifikasi promo & target (segera)" />
        <span style={{ fontSize: 11, color: "rgba(255,255,255,.65)" }}>
          {new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
        </span>
        {hasShift && (
          <Link href="/kasir/tutup" className="pos-tab" style={{ border: ".5px solid rgba(255,255,255,.3)" }}>
            <i className="ti ti-power" style={{ fontSize: 13 }} /> Selesai Shift
          </Link>
        )}
        <span style={{ fontSize: 11.5, color: "#fff", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <i className="ti ti-user-circle" style={{ fontSize: 16 }} /> {userName}
        </span>
      </div>
    </div>
  );
}
