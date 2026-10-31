"use server";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bacaShift, hitungShift, PESAN_LACI_ORANG_LAIN, pesanPenjagaLaci, tutupShift } from "@/lib/tutup-shift";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";

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
  redirect(`/pos/shift?success=open${transactionDraftAck(formData)}`);
}

export async function closeShift(formData: FormData) {
  const supabase = await createClient();
  const shiftId = String(formData.get("shiftId") ?? "");
  const closing = Number(formData.get("closing_balance")) || 0;
  if (!shiftId) redirect(`/pos/shift?error=${encodeURIComponent("Shift tidak valid")}`);

  // Jenis shift TIDAK dikunci di sini: layar ini memang dipakai backoffice untuk
  // menutup shift petshop maupun klinik. Yang penting rumusnya ikut jenis shiftnya,
  // dan itu diurus lib/tutup-shift — dulu layar ini selalu memakai rumus petshop
  // sehingga shift klinik yang ditutup dari sini selisihnya sebesar kas sehari.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/pos/shift?error=${encodeURIComponent("Sesi kamu habis — masuk ulang.")}`);

  const shift = await bacaShift(supabase, shiftId);
  if (!shift) redirect(`/pos/shift?error=${encodeURIComponent("Shift tidak ditemukan")}`);
  // Hak buka layar backoffice bukan hak menutup laci kasir lain.
  if (shift!.opened_by !== user.id) redirect(`/pos/shift?error=${encodeURIComponent(PESAN_LACI_ORANG_LAIN)}`);

  // Selisih kas wajib punya jurnal. Kalau periode terkunci, shift jangan ditutup dulu —
  // status "closed" tanpa jurnal selisih bikin kas buku besar beda dgn kas fisik selamanya.
  const pesanPeriode = await cekPeriode(supabase, hariIniWIB());
  if (pesanPeriode) redirect(`/pos/shift?error=${encodeURIComponent(pesanPeriode)}`);

  const hasil = await tutupShift(supabase, { shift: shift!, closing });
  if (!hasil.ok) redirect(`/pos/shift?error=${encodeURIComponent(hasil.error)}`);

  redirect(`/pos/shift?success=close${transactionDraftAck(formData)}`);
}

// Addendum §1 edge case: laci nyangkut > 24 jam bisa ditutup paksa Owner/Admin cabang.
// Ini SATU-SATUNYA jalan menutup laci orang lain: lewat fungsi basis data yang memeriksa
// peran, cabang laci, umur laci, alasan wajib, lalu mencatat jejak audit. Aksi ini tidak
// pernah menulis tabel laci secara langsung.
export async function forceCloseShift(formData: FormData) {
  const supabase = await createClient();
  const shiftId = String(formData.get("shiftId") ?? "");
  const alasan = String(formData.get("alasan") ?? "").trim();
  if (!shiftId) redirect(`/pos/shift?error=${encodeURIComponent("Shift tidak valid")}`);
  if (alasan.length < 10) {
    redirect(`/pos/shift?error=${encodeURIComponent("Tulis alasan tutup paksa (minimal 10 karakter), misalnya kasir lupa menutup laci kemarin.")}`);
  }

  const shift = await bacaShift(supabase, shiftId);
  if (!shift) redirect(`/pos/shift?error=${encodeURIComponent("Shift tidak ditemukan")}`);

  // Tutup tanpa hitung fisik: kas dihitung = target, selisih 0, tanpa jurnal —
  // tidak ada kas fisik yang benar-benar dihitung, jadi tidak ada selisih yang
  // boleh dibebankan ke siapa pun. Rumus targetnya tetap ikut jenis shift.
  let target: Awaited<ReturnType<typeof hitungShift>>;
  try {
    target = await hitungShift(supabase, shift!);
  } catch (error) {
    redirect(`/pos/shift?error=${encodeURIComponent(error instanceof Error ? error.message : "Uang shift belum dapat dibaca.")}`);
  }
  const { error } = await supabase.rpc("cashier_shift_supervisor_close", {
    p_shift_id: shiftId, p_reason: alasan, p_expected: target.expected, p_breakdown: target.breakdown,
  });
  if (error) redirect(`/pos/shift?error=${encodeURIComponent(pesanPenjagaLaci(error.message))}`);

  redirect(`/pos/shift?success=force`);
}
