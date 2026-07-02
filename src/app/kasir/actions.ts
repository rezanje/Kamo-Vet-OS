"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";

// Shift gate POS kasir — logika sama dgn /pos/shift, redirect ke dunia kasir.
export async function mulaiShiftKasir(formData: FormData) {
  const supabase = await createClient();
  const branchId = String(formData.get("branchId") ?? "");
  const opening = Number(formData.get("opening_balance")) || 0;
  if (!branchId) redirect(`/kasir/mulai?error=${encodeURIComponent("Pilih cabang dulu")}`);

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("cashier_shifts")
    .insert({ branch_id: branchId, opened_by: user?.id ?? null, opening_balance: opening });
  if (error) {
    // 23505 = unique (shift open di cabang ini sudah ada); selain itu biasanya RLS (cabang bukan tugasmu).
    const msg = error.code === "23505"
      ? "Sudah ada shift terbuka di cabang ini"
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
    .from("cashier_shifts").select("opening_balance, branch_id").eq("id", shiftId).single();

  const { data: cashSales } = await supabase
    .from("sales").select("total").eq("shift_id", shiftId).eq("metode_bayar", "Tunai");
  const tunai = (cashSales ?? []).reduce((a, s) => a + Number(s.total), 0);
  const expected = (Number(shift?.opening_balance) || 0) + tunai;
  const selisih = closing - expected;

  await supabase
    .from("cashier_shifts")
    .update({ closing_balance: closing, expected_cash: expected, selisih, closed_at: new Date().toISOString(), status: "closed" })
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

  // shift selesai → balik ke pilihan mode.
  redirect("/mulai");
}
