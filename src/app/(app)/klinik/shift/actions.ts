"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { cashVariance, expectedCash, invoiceCashRows, methodBreakdown } from "@/lib/shift-calc";

// Shift klinik (Addendum §1: shift_type 'klinik' — gate modul pembayaran klinik).
export async function mulaiShiftKlinik(formData: FormData) {
  const supabase = await createClient();
  const branchId = String(formData.get("branchId") ?? "");
  const opening = Number(formData.get("opening_balance")) || 0;
  if (!branchId) redirect(`/klinik/shift?error=${encodeURIComponent("Pilih cabang dulu")}`);

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("cashier_shifts")
    .insert({ branch_id: branchId, opened_by: user?.id ?? null, opening_balance: opening, shift_type: "klinik" });
  if (error) {
    const msg = error.code === "23505"
      ? "Kamu masih punya shift klinik terbuka — tutup dulu sebelum mulai yang baru"
      : "Kamu tidak bertugas di cabang ini — pilih cabang penempatanmu.";
    redirect(`/klinik/shift?error=${encodeURIComponent(msg)}`);
  }
  redirect("/klinik?success=shift");
}

export async function tutupShiftKlinik(formData: FormData) {
  const supabase = await createClient();
  const shiftId = String(formData.get("shiftId") ?? "");
  const closing = Number(formData.get("closing_balance")) || 0;
  if (!shiftId) redirect(`/klinik/shift?error=${encodeURIComponent("Shift tidak valid")}`);

  const { data: shift } = await supabase
    .from("cashier_shifts").select("opening_balance, branch_id, status").eq("id", shiftId).single();
  if (shift?.status !== "open") redirect(`/klinik/shift?error=${encodeURIComponent("Shift sudah ditutup")}`);

  const { data: invoices } = await supabase
    .from("invoices").select("total, dp_amount, paid_status, metode_bayar").eq("shift_id", shiftId);
  const breakdown = methodBreakdown(invoiceCashRows(invoices ?? []));
  const expected = expectedCash(Number(shift?.opening_balance) || 0, breakdown);
  const selisih = cashVariance(closing, expected);

  await supabase
    .from("cashier_shifts")
    .update({
      closing_balance: closing, expected_cash: expected, selisih,
      closing_breakdown: breakdown,
      closed_at: new Date().toISOString(), status: "closed",
    })
    .eq("id", shiftId);

  if (selisih !== 0) {
    const today = new Date().toISOString().slice(0, 10);
    const abs = Math.abs(selisih);
    await postJournal(supabase, {
      tanggal: today, deskripsi: "Selisih kas tutup shift klinik", source: "shift", sourceRef: shiftId,
      branchId: shift?.branch_id ?? null,
      lines: selisih < 0
        ? [{ code: "5901", debit: abs, credit: 0 }, { code: "1101", debit: 0, credit: abs }]
        : [{ code: "1101", debit: abs, credit: 0 }, { code: "5901", debit: 0, credit: abs }],
    });
  }

  redirect("/mulai?success=close");
}
