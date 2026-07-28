// Kerangka halaman master data: tombol kembali, judul berikon, banner
// error/sukses/read-only. Isi form & tabel dikirim sebagai children karena
// field tiap master berbeda — sengaja TIDAK bikin tabel generik.
import Link from "next/link";
import type { ReactNode } from "react";

export function MasterPage({
  back, icon, iconBg = "#eff6ff", iconFg = "#2563eb", title, desc,
  error, success, successMsg, bolehKelola, readOnlyNote, children,
}: {
  back: string;
  icon: string;
  iconBg?: string;
  iconFg?: string;
  title: string;
  desc: string;
  error?: string;
  success?: string;
  successMsg: string;
  bolehKelola: boolean;
  readOnlyNote: string;
  children: ReactNode;
}) {
  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href={back} className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className={`ti ${icon}`} style={{ fontSize: 22, color: iconFg }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>{title}</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>{desc}</div>
        </div>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {successMsg}
        </div>
      )}
      {!bolehKelola && <div className="p2ban"><i className="ti ti-info-circle" /> {readOnlyNote}</div>}

      {children}
    </>
  );
}
