import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { expectedCash, methodBreakdown, PAYMENT_METHODS } from "@/lib/shift-calc";
import { TutupForm } from "./TutupForm";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Selesai shift: breakdown per metode bayar + rekonsiliasi kas fisik (Addendum §1).
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
    .from("sales").select("total, metode_bayar").eq("shift_id", shift.id);
  const breakdown = methodBreakdown(sales ?? []);
  const omset = (sales ?? []).reduce((a, s) => a + Number(s.total), 0);
  const trx = (sales ?? []).length;
  const expected = expectedCash(Number(shift.opening_balance), breakdown);

  // metode di luar daftar standar (data lama) tetap ditampilkan.
  const extraMethods = Object.keys(breakdown).filter(
    (m) => !(PAYMENT_METHODS as readonly string[]).includes(m) && breakdown[m] > 0,
  );

  return (
    <div style={{ minHeight: "70vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "24px 0" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--sb)" }}>Selesai Shift</div>
        <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 2 }}>
          {shift.branchName} · dibuka {new Date(shift.opened_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} · {trx} transaksi
        </div>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", maxWidth: 460 }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <div className="card" style={{ width: "100%", maxWidth: 480, padding: 22 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tm)", letterSpacing: ".04em", marginBottom: 8 }}>
          BREAKDOWN PER METODE BAYAR
        </div>
        {[...PAYMENT_METHODS, ...extraMethods].map((m) => (
          <div key={m} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: ".5px dashed var(--bd)" }}>
            <span style={{ fontSize: 12, color: m === "Tunai" ? "#141413" : "var(--tm)", fontWeight: m === "Tunai" ? 700 : 400 }}>{m}</span>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{rp(breakdown[m] ?? 0)}</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--bd)", marginBottom: 10 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>Grand total omset</span>
          <span style={{ fontSize: 14, fontWeight: 800 }}>{rp(omset)}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <Stat label="Modal awal" value={rp(Number(shift.opening_balance))} />
          <Stat label="Kas seharusnya (sistem)" value={rp(expected)} accent />
        </div>

        <TutupForm shiftId={shift.id} expected={expected} />

        <Link href="/kasir" className="back-btn" style={{ marginTop: 12, justifyContent: "center", width: "100%" }}>
          <i className="ti ti-arrow-left" /> Batal, kembali ke kasir
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: "9px 11px" }}>
      <div style={{ fontSize: 9.5, color: "var(--tm)" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: accent ? "var(--acc)" : "#141413", marginTop: 2 }}>{value}</div>
    </div>
  );
}
