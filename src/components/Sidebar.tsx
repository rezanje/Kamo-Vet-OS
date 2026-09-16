"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MODULES } from "@/lib/nav";
import { modulDiizinkan, type AturanTersimpan } from "@/lib/akses";
import { logout } from "@/app/login/actions";
import { useEffect, useState } from "react";

type Props = {
  branches: { code: string; name: string }[];
  fullName: string;
  role: string;
  /** Aturan Akses Grup; kosong = peran ini masih pakai bawaan. */
  aksesModul?: AturanTersimpan;
};

function activeModule(pathname: string): string {
  if (pathname === "/") return "dashboard";
  return pathname.split("/")[1] || "dashboard";
}

export function Sidebar({ branches, fullName, role, aksesModul = [] }: Props) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setCollapsed(window.localStorage.getItem("vetos:sidebar-collapsed") === "1"), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const toggleCollapsed = () => setCollapsed((current) => {
    const next = !current;
    window.localStorage.setItem("vetos:sidebar-collapsed", next ? "1" : "0");
    return next;
  });
  const active = activeModule(pathname);
  const initials = fullName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className={`sb${collapsed ? " collapsed" : ""}`}>
      <div className="sb-logo">
        <div className="sb-mark">
          <i className="ti ti-paw" />
        </div>
        <div className="sb-brand">
          <div>VetOS</div>
          <div>PT Kamo Group</div>
        </div>
        <button type="button" className="sb-toggle" onClick={toggleCollapsed} title={collapsed ? "Perbesar menu" : "Kecilkan menu"}>
          <i className={`ti ti-chevron-${collapsed ? "right" : "left"}`} />
        </button>
      </div>

      {/* ponytail: branch selector is display-only for now — global branch
          filtering wires in when the first branch-scoped module needs it. */}
      <div className="sb-branch">
        <select defaultValue="all">
          <option value="all">Semua Cabang</option>
          {branches.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <div className="sb-nav">
        {(() => {
          const allow = modulDiizinkan(role, aksesModul);
          return allow ? MODULES.filter((m) => allow.includes(m.id)) : MODULES;
        })().map((m) => {
          const href = m.id === "dashboard" ? "/" : `/${m.id}`;
          return (
            <Link
              key={m.id}
              href={href}
              className={`sbi${active === m.id ? " on" : ""}`}
              title={m.label}
            >
              <i className={`ti ${m.icon}`} />
              <span>{m.label}</span>
            </Link>
          );
        })}
      </div>

      <div className="sb-user">
        <div className="av">{initials || "?"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "#fff", fontSize: 11, fontWeight: 500 }}>
            {fullName}
          </div>
          <div style={{ color: "rgba(255,255,255,.38)", fontSize: 9.5 }}>
            {role}
          </div>
        </div>
        <form action={logout}>
          <button
            type="submit"
            title="Keluar"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "rgba(255,255,255,.55)",
              fontSize: 15,
            }}
          >
            <i className="ti ti-logout" />
          </button>
        </form>
      </div>
    </div>
  );
}
