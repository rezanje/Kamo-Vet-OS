import { logout } from "@/app/login/actions";
import { LABEL_ADMIN_ONLINE } from "@/lib/admin-online";

// Cangkang minimal peran Admin Online: tanpa sidebar, tab halaman, pencarian global, kotak cabang, atau menu apa pun.
// Satu-satunya layar adalah impor penjualan online (lib/admin-online.ts); tidak ada angka keuangan/dashboard di sini.
export function AdminOnlineShell({ fullName, children }: { fullName: string; children: React.ReactNode }) {
  return (
    <div className="shell" data-peran="admin-online">
      <div className="main">
        <div className="topbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}><i className="ti ti-shopping-bag" /> {LABEL_ADMIN_ONLINE}</span>
          <form action={logout} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: "var(--tm)" }}>{fullName}</span>
            <button type="submit" className="btn-def"><i className="ti ti-logout" /> Keluar</button>
          </form>
        </div>
        <div className="ct">{children}</div>
      </div>
    </div>
  );
}
