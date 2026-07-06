import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Shell ringan dashboard pribadi (top bar biru, bukan sidebar admin).
export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const nama = (profile?.full_name ?? user.email ?? "Staff").split(" ")[0];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <div className="pos-topbar no-print">
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <Link href="/mulai" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none" }} title="Kembali ke pilihan mode">
            <div style={{ width: 34, height: 34, background: "#fff", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <i className="ti ti-user-heart" style={{ fontSize: 17, color: "var(--posb)" }} />
            </div>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>DASHBOARD PRIBADI</div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,.65)" }}>{nama}</div>
            </div>
          </Link>
        </div>
        <Link href="/kasir" className="pos-tab" style={{ border: "1px solid rgba(255,255,255,.35)" }}>
          <i className="ti ti-cash-register" style={{ fontSize: 13 }} /> Ke POS Kasir
        </Link>
      </div>
      <div style={{ flex: 1, padding: 16, overflowY: "auto", maxWidth: 900, width: "100%", margin: "0 auto" }}>{children}</div>
    </div>
  );
}
