import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { TutupForm } from "./TutupForm";

// Selesai shift (kasir buta): kasir hanya input kas fisik; tanpa breakdown/ekspektasi
// (spec 2026-07-17). Selisih dihitung server-side, hanya terlihat manajer/finance.
export default async function TutupShiftPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  const { data: sales } = await supabase
    .from("sales").select("id").eq("shift_id", shift.id);
  const trx = (sales ?? []).length;

  return (
    <div className="pshop-wrap">
      <i className="ti ti-bone pshop-deco" style={{ top: "14%", left: "7%", fontSize: 70 }} />
      <i className="ti ti-paw pshop-deco" style={{ top: "16%", right: "9%", fontSize: 86 }} />
      <i className="ti ti-paw pshop-deco" style={{ bottom: "12%", left: "5%", fontSize: 60 }} />
      <i className="ti ti-plus pshop-deco" style={{ top: "42%", right: "6%", fontSize: 46 }} />
      <i className="ti ti-shopping-bag pshop-deco" style={{ bottom: "8%", right: "10%", fontSize: 72 }} />
      <i className="ti ti-home pshop-deco" style={{ bottom: "10%", left: "16%", fontSize: 66 }} />

      <div className="pshop-hero">
        <div className="pshop-welcome" style={{ fontSize: 28 }}>Selesai Shift</div>
        <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 6 }}>
          {shift.branchName} · dibuka {new Date(shift.opened_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} · {trx} transaksi
        </div>
      </div>

      {error && (
        <div className="p2ban pshop-card" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", maxWidth: 460 }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <div className="card pshop-card" style={{ width: "100%", maxWidth: 480, padding: 22 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <i className="ti ti-cash-banknote" style={{ fontSize: 20, color: "var(--posb)" }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>HITUNG UANG DI LACI</div>
            <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>
              Hitung total uang tunai fisik di laci kasir, lalu masukkan jumlahnya untuk menutup shift.
            </div>
          </div>
        </div>

        <TutupForm shiftId={shift.id} />

        <Link href="/kasir" className="back-btn" style={{ marginTop: 12, justifyContent: "center", width: "100%" }}>
          <i className="ti ti-arrow-left" /> Batal, kembali ke kasir
        </Link>
      </div>
    </div>
  );
}
