"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bacaShift, tutupShift } from "@/lib/tutup-shift";
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
  redirect("/pos/shift?success=open");
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
  const shift = await bacaShift(supabase, shiftId);
  if (!shift) redirect(`/pos/shift?error=${encodeURIComponent("Shift tidak ditemukan")}`);

  // Selisih kas wajib punya jurnal. Kalau periode terkunci, shift jangan ditutup dulu —
  // status "closed" tanpa jurnal selisih bikin kas buku besar beda dgn kas fisik selamanya.
  const pesanPeriode = await cekPeriode(supabase, hariIniWIB());
  if (pesanPeriode) redirect(`/pos/shift?error=${encodeURIComponent(pesanPeriode)}`);

  const hasil = await tutupShift(supabase, { shift: shift!, closing });
  if (!hasil.ok) redirect(`/pos/shift?error=${encodeURIComponent(hasil.error)}`);

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

  const shift = await bacaShift(supabase, shiftId);
  if (!shift) redirect(`/pos/shift?error=${encodeURIComponent("Shift tidak ditemukan")}`);
  const { data: waktu } = await supabase
    .from("cashier_shifts").select("opened_at").eq("id", shiftId).single();
  const ageMs = Date.now() - new Date(waktu!.opened_at).getTime();
  if (ageMs < 24 * 60 * 60 * 1000) {
    redirect(`/pos/shift?error=${encodeURIComponent("Force-close hanya untuk shift yang open lebih dari 24 jam")}`);
  }

  // Tutup tanpa hitung fisik: closing = expected, selisih 0, tanpa jurnal —
  // tidak ada kas fisik yang benar-benar dihitung, jadi tidak ada selisih yang
  // boleh dibebankan ke siapa pun. Rumus targetnya tetap ikut jenis shift.
  const hasil = await tutupShift(supabase, { shift: shift!, closing: null });
  if (!hasil.ok) redirect(`/pos/shift?error=${encodeURIComponent(hasil.error)}`);

  redirect(`/pos/shift?success=force`);
}
