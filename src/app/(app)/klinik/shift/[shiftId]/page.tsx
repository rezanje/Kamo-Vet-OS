import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { cashExpenseTotal } from "@/lib/shift-calc";
import { ShiftSummaryCard } from "@/components/ShiftSummaryCard";

const jam = (iso: string) => new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

// Ringkasan setelah shift klinik ditutup — pola sama dengan /kasir/tutup/[shiftId].
export default async function RingkasanShiftKlinikPage({ params }: { params: Promise<{ shiftId: string }> }) {
  const { shiftId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: shift } = await supabase
    .from("cashier_shifts")
    .select("id, opening_balance, closing_balance, expected_cash, selisih, closing_breakdown, opened_at, closed_at, status, opened_by, branches(name)")
    .eq("id", shiftId)
    .maybeSingle();
  if (!shift) notFound();
  if (shift.opened_by !== user.id) redirect("/mulai");
  if (shift.status !== "closed") redirect("/klinik/shift");

  const branch = Array.isArray(shift.branches) ? shift.branches[0] : shift.branches;

  const { data: expenses } = await supabase
    .from("expenses").select("kategori, deskripsi, jumlah, metode_bayar").eq("shift_id", shiftId);

  return (
    <div className="skl-wrap" style={{ minHeight: "60vh" }}>
      <i className="ti ti-paw skl-deco" style={{ top: "12%", left: "6%", fontSize: 80 }} />
      <i className="ti ti-paw skl-deco" style={{ bottom: "10%", left: "12%", fontSize: 54 }} />
      <i className="ti ti-paw skl-deco" style={{ bottom: "16%", right: "8%", fontSize: 86 }} />
      <i className="ti ti-plus skl-deco" style={{ top: "18%", right: "10%", fontSize: 48 }} />
      <i className="ti ti-plus skl-deco" style={{ bottom: "8%", right: "26%", fontSize: 36 }} />

      <div className="skl-hero-head">
        <div className="skl-welcome" style={{ fontSize: 26 }}>Shift Klinik Ditutup</div>
        <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 4 }}>
          {branch?.name} · {jam(shift.opened_at)} – {shift.closed_at ? jam(shift.closed_at) : "—"}
        </div>
      </div>

      <ShiftSummaryCard
        accent="#1d4ed8"
        masukLabel="Kas dari invoice"
        doneHref="/mulai"
        data={{
          openingBalance: Number(shift.opening_balance) || 0,
          closingBalance: Number(shift.closing_balance) || 0,
          expectedCash: Number(shift.expected_cash) || 0,
          selisih: Number(shift.selisih) || 0,
          breakdown: (shift.closing_breakdown ?? {}) as Record<string, number>,
          cashExpenses: cashExpenseTotal(expenses ?? []),
          expenseRows: (expenses ?? []).filter((e) => e.metode_bayar === "Tunai"),
        }}
      />
    </div>
  );
}
