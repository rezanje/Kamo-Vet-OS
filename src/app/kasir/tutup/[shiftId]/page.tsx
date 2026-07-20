import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { cashExpenseTotal } from "@/lib/shift-calc";
import { ShiftSummaryCard } from "@/components/ShiftSummaryCard";

const jam = (iso: string) => new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

// Ringkasan setelah shift petshop ditutup.
export default async function RingkasanTutupShiftPage({ params }: { params: Promise<{ shiftId: string }> }) {
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
  // Milik kasir yang nutup — bukan surface laporan manajer (/pos/shift).
  if (shift.opened_by !== user.id) redirect("/mulai");
  if (shift.status !== "closed") redirect("/kasir/tutup");

  const branch = Array.isArray(shift.branches) ? shift.branches[0] : shift.branches;

  const { data: expenses } = await supabase
    .from("expenses").select("kategori, deskripsi, jumlah, metode_bayar").eq("shift_id", shiftId);

  return (
    <div className="pshop-wrap">
      <i className="ti ti-bone pshop-deco" style={{ top: "14%", left: "7%", fontSize: 70 }} />
      <i className="ti ti-paw pshop-deco" style={{ top: "16%", right: "9%", fontSize: 86 }} />
      <i className="ti ti-paw pshop-deco" style={{ bottom: "12%", left: "5%", fontSize: 60 }} />
      <i className="ti ti-shopping-bag pshop-deco" style={{ bottom: "8%", right: "10%", fontSize: 72 }} />

      <div className="pshop-hero">
        <div className="pshop-welcome" style={{ fontSize: 28 }}>Shift Ditutup</div>
        <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 6 }}>
          {branch?.name} · {jam(shift.opened_at)} – {shift.closed_at ? jam(shift.closed_at) : "—"}
        </div>
      </div>

      <ShiftSummaryCard
        accent="var(--posb)"
        masukLabel="Penjualan tunai"
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
