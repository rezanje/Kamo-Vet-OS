"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { allowedBranchIds, canUseBranch } from "@/lib/branch-access";
import { bacaShift, tutupShift } from "@/lib/tutup-shift";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";

// Shift klinik (Addendum §1: shift_type 'klinik' — gate modul pembayaran klinik).
export async function mulaiShiftKlinik(formData: FormData) {
  const supabase = await createClient();
  const branchId = String(formData.get("branchId") ?? "");
  const opening = Number(formData.get("opening_balance")) || 0;
  if (!branchId) redirect(`/klinik/shift?error=${encodeURIComponent("Pilih cabang dulu")}`);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/klinik/shift?error=${encodeURIComponent("Sesi kamu habis — masuk ulang.")}`);

  // RLS transaksi klinik dilonggarkan untuk demo, jadi cabang dijaga di sini.
  const allowed = await allowedBranchIds(supabase, user.id);
  if (!canUseBranch(allowed, branchId)) {
    redirect(`/klinik/shift?error=${encodeURIComponent("Kamu tidak bertugas di cabang ini — pilih cabang penempatanmu.")}`);
  }

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

  const shift = await bacaShift(supabase, shiftId, "klinik");
  if (!shift) redirect(`/klinik/shift?error=${encodeURIComponent("Shift klinik tidak ditemukan")}`);

  // Selisih kas wajib punya jurnal — shift jangan ditutup kalau periodenya terkunci.
  const pesanPeriode = await cekPeriode(supabase, hariIniWIB());
  if (pesanPeriode) redirect(`/klinik/shift?error=${encodeURIComponent(pesanPeriode)}`);

  const hasil = await tutupShift(supabase, { shift: shift!, closing });
  if (!hasil.ok) redirect(`/klinik/shift?error=${encodeURIComponent(hasil.error)}`);

  // Kasir buta cuma berlaku SEBELUM submit; setelah kas fisik terkunci breakdown boleh dilihat.
  redirect(`/klinik/shift/${shiftId}`);
}
