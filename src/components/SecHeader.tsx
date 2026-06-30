import type { ReactNode } from "react";

// Section header gaya referensi Kamo: badge nomor navy + judul.
// Kanan: action (mis. tombol) kalau diisi, kalau tidak tampil branding KAMO.
export function SecHeader({ num, title, desc, action }: { num: string; title: string; desc: string; action?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, paddingBottom: 12, borderBottom: ".5px solid var(--bd)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ width: 38, height: 38, background: "#16213e", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: "#fff", lineHeight: 1 }}>{num}</span>
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--tx)", letterSpacing: ".01em" }}>{title}</div>
          <div style={{ fontSize: 10, color: "var(--tm)", marginTop: 2 }}>{desc}</div>
        </div>
      </div>
      <div style={{ flexShrink: 0, textAlign: "right" }}>
        {action ?? (
          <>
            <div style={{ fontSize: 15, fontWeight: 900, color: "#141413", lineHeight: 1 }}>
              KAM<i className="ti ti-paw" style={{ fontSize: 13, verticalAlign: -1 }} />
            </div>
            <div style={{ fontSize: 7.5, fontWeight: 600, color: "#9ca3af", letterSpacing: ".1em", marginTop: 2 }}>PET CARE</div>
          </>
        )}
      </div>
    </div>
  );
}
