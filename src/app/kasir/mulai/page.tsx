import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { mulaiShiftKasir } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";

// Layar pembuka POS (mockup "Selamat Datang"): wajib mulai shift sebelum kasir aktif.
export default async function MulaiShiftPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // sudah ada shift → langsung ke kasir.
  const shift = await getOpenShift(supabase as never, user.id);
  if (shift) redirect("/kasir");

  const { data: branches } = await supabase
    .from("branches").select("id, name").eq("is_active", true).in("type", ["PETSHOP", "BOTH"]).order("name");

  return (
    <div className="pshop-wrap">
      <i className="ti ti-bone pshop-deco" style={{ top: "14%", left: "7%", fontSize: 70 }} />
      <i className="ti ti-paw pshop-deco" style={{ top: "16%", right: "9%", fontSize: 86 }} />
      <i className="ti ti-paw pshop-deco" style={{ bottom: "12%", left: "5%", fontSize: 60 }} />
      <i className="ti ti-plus pshop-deco" style={{ top: "42%", right: "6%", fontSize: 46 }} />
      <i className="ti ti-shopping-bag pshop-deco" style={{ bottom: "8%", right: "10%", fontSize: 72 }} />
      <i className="ti ti-home pshop-deco" style={{ bottom: "10%", left: "16%", fontSize: 66 }} />

      <div className="pshop-hero">
        <div className="pshop-welcome">Selamat Datang!</div>
        <div style={{ fontSize: 13, color: "var(--tm)", marginTop: 2 }}>Sistem POS Kamo Petshop</div>
        <div style={{ fontSize: 11.5, color: "var(--td)", marginTop: 8 }}>Silakan mulai shift untuk mengakses sistem kasir.</div>
      </div>

      {error && (
        <div className="p2ban pshop-card" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", maxWidth: 420 }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <form action={mulaiShiftKasir} className="card pshop-card" style={{ width: "100%", maxWidth: 440, padding: 22 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <i className="ti ti-cash-banknote" style={{ fontSize: 20, color: "var(--posb)" }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>UANG DI KASIR SAAT INI</div>
            <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>
              Masukkan jumlah uang tunai yang ada di kasir sebelum memulai shift.
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label className="flab">Cabang / toko *</label>
          <select className="fi" name="branchId" required defaultValue="">
            <option value="" disabled>Pilih cabang tempat kamu bertugas</option>
            {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label className="flab">Modal awal kas (Rp) *</label>
          <div className="pshop-rp">
            <span>Rp</span>
            <input className="fi" name="opening_balance" type="number" min={0} step={1000} placeholder="0" required />
          </div>
        </div>

        <SubmitButton className="kpos-bayar" icon="ti-player-play" pendingText="Memulai shift…">MULAI SHIFT</SubmitButton>
      </form>
    </div>
  );
}
