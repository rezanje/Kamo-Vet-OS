import type { ReactNode } from "react";

// Bingkai kartu yang sama dengan halaman login, dipakai halaman lupa password & password baru.
export function KartuMasuk({ subjudul, children }: { subjudul: string; children: ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        background: "linear-gradient(160deg, #eef4ff 0%, #f6faff 55%, #eaf6f0 100%)",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 380, padding: 0, overflow: "hidden" }}>
        <div style={{ background: "linear-gradient(90deg, var(--posb-dk), var(--posb))", padding: "26px 28px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: "rgba(255,255,255,.16)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <i className="ti ti-paw" style={{ fontSize: 22, color: "#fff" }} />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: ".02em" }}>VetOS</div>
            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,.8)" }}>{subjudul}</div>
          </div>
        </div>
        <div style={{ padding: "24px 28px 28px", display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
      </div>
    </main>
  );
}

export function Pesan({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div role={ok ? "status" : "alert"} className="p2ban"
      style={ok ? { background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d", margin: 0 } : { background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", margin: 0 }}>
      <i className={ok ? "ti ti-circle-check" : "ti ti-alert-circle"} /> {children}
    </div>
  );
}
