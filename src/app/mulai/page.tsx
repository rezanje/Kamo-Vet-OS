import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Pilih mode kerja setelah login: dashboard VetOS penuh atau dunia POS kasir.
export default async function MulaiPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const { success } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name, role").eq("id", user.id).maybeSingle();

  // FINANCE tidak pegang POS — langsung ke dashboard, skip pilihan mode kerja.
  if (profile?.role === "FINANCE") redirect("/");

  const nama = profile?.full_name ?? user.email ?? "Pengguna";

  return (
    <div className="pshop-wrap" style={{ minHeight: "100vh", borderRadius: 0, gap: 28 }}>
      <i className="ti ti-bone pshop-deco" style={{ top: "14%", left: "7%", fontSize: 70 }} />
      <i className="ti ti-paw pshop-deco" style={{ top: "16%", right: "9%", fontSize: 86 }} />
      <i className="ti ti-paw pshop-deco" style={{ bottom: "16%", left: "5%", fontSize: 60 }} />
      <i className="ti ti-plus pshop-deco" style={{ top: "42%", right: "6%", fontSize: 46 }} />
      <i className="ti ti-shopping-bag pshop-deco" style={{ bottom: "10%", right: "10%", fontSize: 72 }} />
      <i className="ti ti-home pshop-deco" style={{ bottom: "12%", left: "16%", fontSize: 66 }} />

      {success === "close" && (
        <div className="pshop-card" style={{ position: "absolute", top: 20, display: "inline-flex", alignItems: "center", gap: 8, background: "#ecfdf5", border: ".5px solid #6ee7b7", color: "#047857", borderRadius: 999, padding: "8px 18px", fontSize: 12.5, fontWeight: 600 }}>
          <i className="ti ti-circle-check" /> Shift ditutup.
        </div>
      )}
      <div className="pshop-hero">
        <div style={{ width: 52, height: 52, background: "var(--acc)", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
          <i className="ti ti-paw" style={{ fontSize: 28, color: "#fff" }} />
        </div>
        <div className="pshop-welcome" style={{ fontSize: 24 }}>Selamat datang, {nama.split(" ")[0]}!</div>
        <div style={{ fontSize: 12.5, color: "var(--tm)", marginTop: 4 }}>
          Mau kerja di mana hari ini? <span style={{ opacity: .7 }}>({profile?.role ?? "—"})</span>
        </div>
      </div>

      <div className="pshop-card" style={{ display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "center", maxWidth: 860 }}>
        {profile?.role === "STAFF" ? (
          <>
            <Link href="/me" style={{ textDecoration: "none" }}>
              <div className="mulai-tile">
                <i className="ti ti-user-heart" style={{ fontSize: 40, color: "var(--sb)" }} />
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--tx)" }}>Dashboard Pribadi</div>
                <div style={{ fontSize: 11, color: "var(--tm)", textAlign: "center" }}>Quest, KPI, absensi & pengajuan cuti kamu.</div>
              </div>
            </Link>
            <Link href="/kasir" style={{ textDecoration: "none" }}>
              <div className="mulai-tile">
                <i className="ti ti-building-store" style={{ fontSize: 40, color: "var(--acc)" }} />
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--tx)" }}>Petshop</div>
                <div style={{ fontSize: 11, color: "var(--tm)", textAlign: "center" }}>Mulai shift, transaksi kasir, pengeluaran & persediaan toko.</div>
              </div>
            </Link>
            <Link href="/klinik/shift" style={{ textDecoration: "none" }}>
              <div className="mulai-tile">
                <i className="ti ti-stethoscope" style={{ fontSize: 40, color: "var(--acc)" }} />
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--tx)" }}>Klinik</div>
                <div style={{ fontSize: 11, color: "var(--tm)", textAlign: "center" }}>Mulai shift & pembayaran klinik.</div>
              </div>
            </Link>
          </>
        ) : (
          <>
            <Link href="/" style={{ textDecoration: "none" }}>
              <div className="mulai-tile">
                <i className="ti ti-layout-dashboard" style={{ fontSize: 40, color: "var(--sb)" }} />
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--tx)" }}>Dashboard VetOS</div>
                <div style={{ fontSize: 11, color: "var(--tm)", textAlign: "center" }}>Klinik, CRM, Keuangan, HRIS, laporan — semua modul.</div>
              </div>
            </Link>
            <Link href="/kasir" style={{ textDecoration: "none" }}>
              <div className="mulai-tile">
                <i className="ti ti-building-store" style={{ fontSize: 40, color: "var(--acc)" }} />
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--tx)" }}>POS Kasir</div>
                <div style={{ fontSize: 11, color: "var(--tm)", textAlign: "center" }}>Mulai shift, transaksi kasir, pengeluaran & persediaan toko.</div>
              </div>
            </Link>
          </>
        )}
      </div>

      <div className="pshop-card" style={{ fontSize: 10.5, color: "var(--td)" }}>VetOS · PT Kamo Group</div>
    </div>
  );
}
