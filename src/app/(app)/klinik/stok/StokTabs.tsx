import Link from "next/link";

// Tab-nav 3 modul stok klinik (referensi KAMO CLINIC): Pengeluaran / Permintaan / Penerimaan.
const TABS = [
  { key: "pengeluaran", label: "Pengeluaran", icon: "ti-calendar-stats", href: "/klinik/pengeluaran" },
  { key: "permintaan", label: "Permintaan Barang", icon: "ti-shopping-cart", href: "/klinik/permintaan" },
  { key: "penerimaan", label: "Penerimaan Barang", icon: "ti-package-import", href: "/klinik/penerimaan" },
] as const;

export function StokTabs({ active, action }: { active: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: ".5px solid var(--bd)", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
      <div style={{ display: "flex", gap: 24 }}>
        {TABS.map((t) => (
          <Link key={t.key} href={t.href} className="back-btn" style={{
            padding: "4px 0 12px", fontSize: 13, fontWeight: active === t.key ? 700 : 500, borderRadius: 0,
            color: active === t.key ? "#2563eb" : "var(--tm)",
            borderBottom: active === t.key ? "2px solid #2563eb" : "2px solid transparent",
          }}>
            <i className={`ti ${t.icon}`} /> {t.label}
          </Link>
        ))}
      </div>
      {action}
    </div>
  );
}

export function StatCard({ label, value, color, bg, icon, big }: { label: string; value: string; color: string; bg: string; icon: string; big?: boolean }) {
  return (
    <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <div>
        <div style={{ fontSize: 10.5, color: "var(--tm)", fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: big ? 22 : 24, fontWeight: 800, color, lineHeight: 1.2, marginTop: 4 }}>{value}</div>
      </div>
      <div style={{ width: 42, height: 42, borderRadius: 11, background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <i className={`ti ${icon}`} style={{ color, fontSize: 20 }} />
      </div>
    </div>
  );
}
