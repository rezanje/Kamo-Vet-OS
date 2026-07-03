"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { cashVariance, expectedCash, methodBreakdown } from "@/lib/shift-calc";

// Shift gate POS kasir — logika sama dgn /pos/shift, redirect ke dunia kasir.
export async function mulaiShiftKasir(formData: FormData) {
  const supabase = await createClient();
  const branchId = String(formData.get("branchId") ?? "");
  const opening = Number(formData.get("opening_balance")) || 0;
  if (!branchId) redirect(`/kasir/mulai?error=${encodeURIComponent("Pilih cabang dulu")}`);

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("cashier_shifts")
    .insert({ branch_id: branchId, opened_by: user?.id ?? null, opening_balance: opening, shift_type: "petshop" });
  if (error) {
    // 23505 = unique (kamu masih punya shift petshop terbuka); selain itu biasanya RLS (cabang bukan tugasmu).
    const msg = error.code === "23505"
      ? "Kamu masih punya shift terbuka — tutup dulu sebelum mulai yang baru"
      : "Kamu tidak bertugas di cabang ini — pilih cabang penempatanmu.";
    redirect(`/kasir/mulai?error=${encodeURIComponent(msg)}`);
  }

  redirect("/kasir");
}

export async function tutupShiftKasir(formData: FormData) {
  const supabase = await createClient();
  const shiftId = String(formData.get("shiftId") ?? "");
  const closing = Number(formData.get("closing_balance")) || 0;
  if (!shiftId) redirect(`/kasir/tutup?error=${encodeURIComponent("Shift tidak valid")}`);

  const { data: shift } = await supabase
    .from("cashier_shifts").select("opening_balance, branch_id, status").eq("id", shiftId).single();
  if (shift?.status !== "open") redirect(`/kasir/mulai?error=${encodeURIComponent("Shift sudah ditutup")}`);

  // Addendum §1: breakdown per metode bayar, kas fisik vs sistem.
  const { data: sales } = await supabase
    .from("sales").select("total, metode_bayar").eq("shift_id", shiftId);
  const breakdown = methodBreakdown(sales ?? []);
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
    const absSelisih = Math.abs(selisih);
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

  // laporan shift (Addendum §1: bisa dicetak, masuk dashboard manajer).
  redirect(`/pos/shift/${shiftId}`);
}
