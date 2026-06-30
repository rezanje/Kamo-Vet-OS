"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";

export async function openShift(formData: FormData) {
  const supabase = await createClient();
  const branchId = String(formData.get("branchId") ?? "");
  const opening = Number(formData.get("opening_balance")) || 0;
  if (!branchId) redirect(`/pos/shift?error=${encodeURIComponent("Pilih cabang dulu")}`);

  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("cashier_shifts")
    .insert({ branch_id: branchId, opened_by: user?.id ?? null, opening_balance: opening });
  if (error) {
    // unique index: sudah ada shift open di cabang ini.
    redirect(`/pos/shift?error=${encodeURIComponent("Sudah ada shift terbuka di cabang ini")}`);
  }
  redirect("/pos/shift?success=open");
}

export async function closeShift(formData: FormData) {
  const supabase = await createClient();
  const shiftId = String(formData.get("shiftId") ?? "");
  const closing = Number(formData.get("closing_balance")) || 0;
  if (!shiftId) redirect(`/pos/shift?error=${encodeURIComponent("Shift tidak valid")}`);

  const { data: shift } = await supabase
    .from("cashier_shifts").select("opening_balance, branch_id").eq("id", shiftId).single();

  // expected = modal awal + total penjualan tunai selama shift.
  const { data: cashSales } = await supabase
    .from("sales").select("total").eq("shift_id", shiftId).eq("metode_bayar", "Tunai");
  const tunai = (cashSales ?? []).reduce((a, s) => a + Number(s.total), 0);
  const expected = (Number(shift?.opening_balance) || 0) + tunai;
  const selisih = closing - expected;

  await supabase
    .from("cashier_shifts")
    .update({ closing_balance: closing, expected_cash: expected, selisih, closed_at: new Date().toISOString(), status: "closed" })
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
