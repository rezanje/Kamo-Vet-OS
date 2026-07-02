import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { tutupShiftKasir } from "../actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Selesai shift: hitung kas fisik → rekonsiliasi otomatis, lalu keluar dari POS.
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

  const { data: cashSales } = await supabase
    .from("sales").select("total, metode_bayar").eq("shift_id", shift.id);
  const tunai = (cashSales ?? []).filter((s) => s.metode_bayar === "Tunai").reduce((a, s) => a + Number(s.total), 0);
  const nonTunai = (cashSales ?? []).filter((s) => s.metode_bayar !== "Tunai").reduce((a, s) => a + Number(s.total), 0);
  const trx = (cashSales ?? []).length;
  const expected = Number(shift.opening_balance) + tunai;

  return (
    <div style={{ minHeight: "70vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--sb)" }}>Selesai Shift</div>
        <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 2 }}>{shift.branchName} · dibuka {new Date(shift.opened_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</div>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", maxWidth: 440 }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <div className="card" style={{ width: "100%", maxWidth: 460, padding: 22 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <Stat label="Modal awal" value={rp(Number(shift.opening_balance))} />
          <Stat label="Transaksi" value={`${trx}x`} />
          <Stat label="Penjualan tunai" value={rp(tunai)} />
          <Stat label="Non-tunai" value={rp(nonTunai)} muted />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderTop: "1px solid var(--bd)", marginBottom: 12 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Kas seharusnya di laci</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--acc)" }}>{rp(expected)}</span>
        </div>

        <form action={tutupShiftKasir}>
          <input type="hidden" name="shiftId" value={shift.id} />
          <label className="flab">Uang kas dihitung (fisik) *</label>
          <input className="fi" name="closing_balance" type="number" min={0} step={500} placeholder="Hitung uang di laci" required style={{ marginBottom: 6 }} />
          <div style={{ fontSize: 9.5, color: "var(--td)", marginBottom: 12 }}>Selisih (dihitung − seharusnya) otomatis dicatat ke jurnal & rekonsiliasi.</div>
          <button type="submit" className="pay-btn"><i className="ti ti-lock" /> Tutup Shift & Keluar</button>
        </form>

        <Link href="/kasir" className="back-btn" style={{ marginTop: 12, justifyContent: "center", width: "100%" }}>
          <i className="ti ti-arrow-left" /> Batal, kembali ke kasir
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: "9px 11px" }}>
      <div style={{ fontSize: 9.5, color: "var(--tm)" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: muted ? "var(--td)" : "#141413", marginTop: 2 }}>{value}</div>
    </div>
  );
}
