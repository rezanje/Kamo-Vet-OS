import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Pilih mode kerja setelah login: dashboard VetOS penuh atau dunia POS kasir.
export default async function MulaiPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name, role").eq("id", user.id).maybeSingle();

  const nama = profile?.full_name ?? user.email ?? "Pengguna";

  return (
    <div style={{ minHeight: "100vh", background: "var(--sb)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28, padding: 20 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 52, height: 52, background: "var(--acc)", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
          <i className="ti ti-paw" style={{ fontSize: 28, color: "#fff" }} />
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>Selamat datang, {nama.split(" ")[0]}!</div>
        <div style={{ fontSize: 12.5, color: "rgba(255,255,255,.55)", marginTop: 4 }}>
          Mau kerja di mana hari ini? <span style={{ opacity: .7 }}>({profile?.role ?? "—"})</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 260px))", gap: 16, justifyContent: "center" }}>
        <Link href="/" style={{ textDecoration: "none" }}>
          <div className="mulai-tile">
            <i className="ti ti-layout-dashboard" style={{ fontSize: 40, color: "var(--sb)" }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--tx)" }}>Dashboard VetOS</div>
            <div style={{ fontSize: 11, color: "var(--tm)", textAlign: "center" }}>Klinik, CRM, Keuangan, HRIS, laporan — semua modul.</div>
          </div>
        </Link>
        <Link href="/kasir" style={{ textDecoration: "none" }}>
          <div className="mulai-tile">
            <i className="ti ti-cash-register" style={{ fontSize: 40, color: "var(--acc)" }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--tx)" }}>POS Kasir</div>
            <div style={{ fontSize: 11, color: "var(--tm)", textAlign: "center" }}>Mulai shift, transaksi kasir, pengeluaran & persediaan toko.</div>
          </div>
        </Link>
      </div>

      <div style={{ fontSize: 10.5, color: "rgba(255,255,255,.35)" }}>VetOS · PT Kamo Group</div>
    </div>
  );
}
