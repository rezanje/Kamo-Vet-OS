import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/PrintButton";
import { PAYMENT_METHODS } from "@/lib/shift-calc";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

// Laporan shift (Addendum §1: dicetak/export, masuk dashboard manajer cabang).
export default async function LaporanShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: shift } = await supabase
    .from("cashier_shifts")
    .select("id, shift_type, opening_balance, closing_balance, expected_cash, selisih, closing_breakdown, opened_at, closed_at, status, branches(name, code), profiles(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!shift) notFound();

  const branch = one(shift.branches as Rel<{ name: string; code: string }>);
  const kasir = one(shift.profiles as Rel<{ full_name: string | null }>);
  const breakdown = (shift.closing_breakdown ?? {}) as Record<string, number>;
  const methods = [
    ...PAYMENT_METHODS,
    ...Object.keys(breakdown).filter((m) => !(PAYMENT_METHODS as readonly string[]).includes(m)),
  ];
  const omset = Object.values(breakdown).reduce((a, v) => a + Number(v), 0);
  const sel = Number(shift.selisih ?? 0);

  return (
    <>
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos/shift" className="back-btn"><i className="ti ti-arrow-left" /> Shift Kasir</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Laporan Shift</span>
        <div style={{ marginLeft: "auto" }}><PrintButton /></div>
      </div>

      <div className="card" style={{ maxWidth: 560, margin: "0 auto", padding: 24 }}>
        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--sb)" }}>LAPORAN SHIFT {shift.shift_type === "klinik" ? "KLINIK" : "PETSHOP"}</div>
          <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>{branch?.name ?? "—"} ({branch?.code ?? "—"})</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11.5, marginBottom: 14 }}>
          <Info label="Kasir" value={kasir?.full_name ?? "—"} />
          <Info label="Status" value={shift.status === "closed" ? "Ditutup" : "Masih terbuka"} />
          <Info label="Buka" value={fmtDt(shift.opened_at)} />
          <Info label="Tutup" value={fmtDt(shift.closed_at)} />
        </div>

        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--tm)", letterSpacing: ".04em", marginBottom: 6 }}>
          OMSET PER METODE BAYAR
        </div>
        {methods.map((m) => (
          <div key={m} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: ".5px dashed var(--bd)", fontSize: 12 }}>
            <span style={{ color: "var(--tm)" }}>{m}</span>
            <span style={{ fontWeight: 600 }}>{rp(breakdown[m] ?? 0)}</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--bd)", fontSize: 12.5, fontWeight: 700 }}>
          <span>Grand total omset</span><span>{rp(omset)}</span>
        </div>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <Info label="Modal awal" value={rp(Number(shift.opening_balance))} />
          <Info label="Kas seharusnya" value={rp(Number(shift.expected_cash ?? 0))} />
          <Info label="Kas dihitung" value={rp(Number(shift.closing_balance ?? 0))} />
        </div>

        <div
          style={{
            marginTop: 12, padding: "10px 12px", borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center",
            background: sel === 0 ? "#e8f5ee" : sel > 0 ? "#eff6ff" : "#fef2f2",
            border: `.5px solid ${sel === 0 ? "#86efac" : sel > 0 ? "#93c5fd" : "#fca5a5"}`,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700 }}>
            Selisih kas {sel === 0 ? "(sesuai)" : sel > 0 ? "(lebih)" : "(kurang)"}
          </span>
          <span style={{ fontSize: 15, fontWeight: 800, color: sel === 0 ? "#15803d" : sel > 0 ? "#1d4ed8" : "#b91c1c" }}>
            {sel > 0 ? "+" : ""}{rp(sel)}
          </span>
        </div>

        <div className="no-print" style={{ marginTop: 16, textAlign: "center" }}>
          <Link href="/mulai" className="back-btn" style={{ justifyContent: "center" }}>
            <i className="ti ti-home" /> Kembali ke pilihan mode
          </Link>
        </div>
      </div>
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: "7px 10px" }}>
      <div style={{ fontSize: 9, color: "var(--tm)" }}>{label}</div>
      <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 1 }}>{value}</div>
    </div>
  );
}
