"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { cashExpenseTotal, cashVariance, expectedCash, methodBreakdown } from "@/lib/shift-calc";

export async function openShift(formData: FormData) {
  const supabase = await createClient();
  const branchId = String(formData.get("branchId") ?? "");
  const opening = Number(formData.get("opening_balance")) || 0;
  if (!branchId) redirect(`/pos/shift?error=${encodeURIComponent("Pilih cabang dulu")}`);

  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("cashier_shifts")
    .insert({ branch_id: branchId, opened_by: user?.id ?? null, opening_balance: opening, shift_type: "petshop" });
  if (error) {
    // unique index: kamu masih punya shift petshop yang open.
    redirect(`/pos/shift?error=${encodeURIComponent("Kamu masih punya shift terbuka — tutup dulu")}`);
  }
  redirect("/pos/shift?success=open");
}

export async function closeShift(formData: FormData) {
  const supabase = await createClient();
  const shiftId = String(formData.get("shiftId") ?? "");
  const closing = Number(formData.get("closing_balance")) || 0;
  if (!shiftId) redirect(`/pos/shift?error=${encodeURIComponent("Shift tidak valid")}`);

  const { data: shift } = await supabase
    .from("cashier_shifts").select("opening_balance, branch_id, status").eq("id", shiftId).single();
  if (shift?.status !== "open") redirect(`/pos/shift?error=${encodeURIComponent("Shift sudah ditutup")}`);

  // Addendum §1: breakdown per metode disimpan untuk laporan shift.
  const { data: sales } = await supabase
    .from("sales").select("total, metode_bayar").eq("shift_id", shiftId);
  const { data: expenses } = await supabase
    .from("expenses").select("jumlah, metode_bayar").eq("shift_id", shiftId);
  const breakdown = methodBreakdown(sales ?? []);
  const expected = expectedCash(Number(shift?.opening_balance) || 0, breakdown, cashExpenseTotal(expenses ?? []));
  const selisih = cashVariance(closing, expected);

  await supabase
    .from("cashier_shifts")
    .update({
      closing_balance: closing, expected_cash: expected, selisih, closing_breakdown: breakdown,
      closed_at: new Date().toISOString(), status: "closed",
    })
    .eq("id", shiftId);

  // Accounting: post selisih kas only when non-zero.
  if (selisih !== 0) {
    const today = new Date().toISOString().slice(0, 10);
    const absSelisih = Math.abs(selisih);
    // selisih < 0 = kurang: Dr Selisih Kas, Cr Kas.
    // selisih > 0 = lebih:  Dr Kas, Cr Selisih Kas.
    await postJournal(supabase, {
      tanggal: today,
      deskripsi: "Selisih kas tutup shift",
      source: "shift",
      sourceRef: shiftId,
      branchId: shift?.branch_id ?? null,
      lines: selisih < 0
        ? [
            { code: "5901", debit: absSelisih, credit: 0 },
            { code: "1101", debit: 0, credit: absSelisih },
          ]
        : [
            { code: "1101", debit: absSelisih, credit: 0 },
            { code: "5901", debit: 0, credit: absSelisih },
          ],
    });
  }

  redirect("/pos/shift?success=close");
}

// Addendum §1 edge case: shift nyangkut >24 jam bisa ditutup paksa manajer cabang.
export async function forceCloseShift(formData: FormData) {
  const supabase = await createClient();
  const shiftId = String(formData.get("shiftId") ?? "");
  if (!shiftId) redirect(`/pos/shift?error=${encodeURIComponent("Shift tidak valid")}`);

  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    redirect(`/pos/shift?error=${encodeURIComponent("Hanya manajer/owner yang bisa force-close shift")}`);
  }

  const { data: shift } = await supabase
    .from("cashier_shifts").select("opening_balance, branch_id, status, opened_at").eq("id", shiftId).single();
  if (shift?.status !== "open") redirect(`/pos/shift?error=${encodeURIComponent("Shift sudah ditutup")}`);
  const ageMs = Date.now() - new Date(shift.opened_at).getTime();
  if (ageMs < 24 * 60 * 60 * 1000) {
    redirect(`/pos/shift?error=${encodeURIComponent("Force-close hanya untuk shift yang open lebih dari 24 jam")}`);
  }

  // tutup tanpa hitung fisik: closing = expected (selisih 0), ditandai force-close.
  const { data: sales } = await supabase
    .from("sales").select("total, metode_bayar").eq("shift_id", shiftId);
  const { data: expenses } = await supabase
    .from("expenses").select("jumlah, metode_bayar").eq("shift_id", shiftId);
  const breakdown = methodBreakdown(sales ?? []);
  const expected = expectedCash(Number(shift?.opening_balance) || 0, breakdown, cashExpenseTotal(expenses ?? []));

  await supabase
    .from("cashier_shifts")
    .update({
      closing_balance: expected, expected_cash: expected, selisih: 0, closing_breakdown: breakdown,
      closed_at: new Date().toISOString(), status: "closed",
    })
    .eq("id", shiftId);

  redirect(`/pos/shift?success=force`);
}
