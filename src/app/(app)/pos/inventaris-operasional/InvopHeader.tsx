import Link from "next/link";
import { INVOP_PATH, type InvopBranch } from "@/lib/inventaris-operasional";

const TABS = [
  { key: "daftar", label: "Daftar Barang", href: INVOP_PATH, icon: "ti-list" },
  { key: "opname", label: "Opname", href: `${INVOP_PATH}/opname`, icon: "ti-clipboard-check" },
  { key: "riwayat", label: "Riwayat Cabang", href: `${INVOP_PATH}/riwayat`, icon: "ti-history" },
] as const;

/** Judul, pilihan cabang (hanya cabang yang boleh dibuka), tab, dan pesan sukses/gagal. */
export function InvopHeader({ active, branches, branch, success, error }: {
  active: (typeof TABS)[number]["key"];
  branches: InvopBranch[];
  branch: InvopBranch | null;
  success?: string;
  error?: string;
}) {
  const here = TABS.find(t => t.key === active)!.href;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11, flexWrap: "wrap" }}>
        <Link href="/pos" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Inventaris Operasional</span>
        {branches.length > 1 ? (
          <form method="get" action={here} style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <select className="fi" name="cabang" defaultValue={branch?.id} aria-label="Cabang" style={{ width: 220 }}>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button type="submit" className="btn-def" style={{ padding: "4px 12px", fontSize: 10.5 }}>
              <i className="ti ti-building-store" /> Pilih cabang
            </button>
          </form>
        ) : branch ? (
          <span className="bge g" style={{ marginLeft: "auto" }}><i className="ti ti-building-store" /> {branch.name}</span>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {TABS.map(t => (
          <Link key={t.key} href={branch ? `${t.href}?cabang=${branch.id}` : t.href}
            className={t.key === active ? "btn-acc" : "btn-def"} aria-current={t.key === active ? "page" : undefined}
            style={{ textDecoration: "none", padding: "4px 12px", fontSize: 11 }}>
            <i className={`ti ${t.icon}`} /> {t.label}
          </Link>
        ))}
      </div>
      {success && (
        <div className="p2ban" role="status" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success}
        </div>
      )}
      {error && (
        <div className="p2ban" role="alert" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
    </>
  );
}

export function TanpaCabang() {
  return (
    <div className="crm-sec" style={{ textAlign: "center", color: "var(--td)", fontSize: 12, padding: "24px 0" }}>
      Akun ini belum punya cabang yang bisa dibuka untuk Inventaris Operasional.
    </div>
  );
}
