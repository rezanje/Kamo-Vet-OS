"use server";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOperationalBranch } from "@/lib/operational-branch-server";
import { bacaShift, PESAN_LACI_ORANG_LAIN, tutupShift } from "@/lib/tutup-shift";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";

// Shift klinik (Addendum §1: shift_type 'klinik' — gate modul pembayaran klinik).
export async function mulaiShiftKlinik(formData: FormData) {
  const supabase = await createClient();
  const branchId = String(formData.get("branchId") ?? "");
  const openingInput = String(formData.get("opening_balance") ?? "").trim();
  const opening = Number(openingInput);
  if (!branchId) redirect(`/klinik/shift?error=${encodeURIComponent("Pilih cabang dulu")}`);
  if (!openingInput || !Number.isFinite(opening) || opening < 0) {
    redirect(`/klinik/shift?error=${encodeURIComponent("Isi modal awal kas dengan angka nol atau lebih.")}`);
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/klinik/shift?error=${encodeURIComponent("Sesi kamu habis — masuk ulang.")}`);

  const branch = await requireOperationalBranch(supabase, user.id, "klinik");
  if (branch.id !== branchId) redirect(`/klinik/shift?error=${encodeURIComponent("Cabang form berubah. Muat ulang sebelum membuka shift.")}`);

  const { error } = await supabase
    .from("cashier_shifts")
    .insert({ branch_id: branchId, opened_by: user?.id ?? null, opening_balance: opening, shift_type: "klinik" });
  if (error) {
    const msg = error.code === "23505"
      ? "Kamu masih punya shift klinik terbuka — tutup dulu sebelum mulai yang baru"
      : "Kamu tidak bertugas di cabang ini — pilih cabang penempatanmu.";
    redirect(`/klinik/shift?error=${encodeURIComponent(msg)}`);
  }
  redirect(`/klinik?success=shift${transactionDraftAck(formData)}`);
}

export async function tutupShiftKlinik(formData: FormData) {
  const supabase = await createClient();
  const shiftId = String(formData.get("shiftId") ?? "");
  const closing = Number(formData.get("closing_balance")) || 0;
  if (!shiftId) redirect(`/klinik/shift?error=${encodeURIComponent("Shift tidak valid")}`);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/klinik/shift?error=${encodeURIComponent("Sesi kamu habis — masuk ulang.")}`);

  const shift = await bacaShift(supabase, shiftId, "klinik");
  if (!shift) redirect(`/klinik/shift?error=${encodeURIComponent("Shift klinik tidak ditemukan")}`);
  // Akses halaman klinik bukan berarti memegang laci orang lain: hanya pemilik laci yang
  // menghitung dan menutupnya. Basis data menolak hal yang sama; ini supaya pesannya jelas.
  if (shift!.opened_by !== user.id) {
    redirect(`/klinik/shift?error=${encodeURIComponent(PESAN_LACI_ORANG_LAIN)}`);
  }

  // Selisih kas wajib punya jurnal — shift jangan ditutup kalau periodenya terkunci.
  const pesanPeriode = await cekPeriode(supabase, hariIniWIB());
  if (pesanPeriode) redirect(`/klinik/shift?error=${encodeURIComponent(pesanPeriode)}`);

  const hasil = await tutupShift(supabase, { shift: shift!, closing });
  if (!hasil.ok) redirect(`/klinik/shift?error=${encodeURIComponent(hasil.error)}`);

  // Kasir buta cuma berlaku SEBELUM submit; setelah kas fisik terkunci breakdown boleh dilihat.
  redirect(`/klinik/shift/${shiftId}?success=closed${transactionDraftAck(formData)}`);
}
