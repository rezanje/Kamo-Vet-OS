"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { allowedBranchIds, canUseBranch } from "@/lib/branch-access";
import { bacaShift, tutupShift } from "@/lib/tutup-shift";
import { nomorHpValid, PESAN_HP_TIDAK_VALID } from "@/lib/kontak";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";

export type NewCustResult =
  | { ok: true; customer: { id: string; name: string; phone: string; points: number; tier: string | null; kategori: string; trx: number; belanja: number } }
  | { ok: false; error: string };

// Tambah customer inline dari POS — insert + kembalikan row (BUKAN redirect: cart di client, jangan pindah halaman).
export async function tambahCustomerKasir(formData: FormData): Promise<NewCustResult> {
  const supabase = await createClient();

  const nama = String(formData.get("nama") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  const dob = String(formData.get("dob") ?? "") || null;
  const alamat = String(formData.get("alamat") ?? "").trim() || null;
  const pekerjaan = String(formData.get("pekerjaan") ?? "").trim() || null;
  const sumber_info = String(formData.get("sumber_info") ?? "").trim() || null;
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  if (!nama || !phone) return { ok: false, error: "Nama dan No. HP wajib diisi" };
  // No. HP = kunci pengenal pelanggan lama; nomor asal bikin dedup gagal.
  if (!nomorHpValid(phone)) return { ok: false, error: PESAN_HP_TIDAK_VALID };

  // dedup by phone — sama pola /crm/pelanggan/baru.
  const { data: existing } = await supabase.from("customers").select("id").eq("phone", phone).maybeSingle();
  if (existing) return { ok: false, error: "No HP sudah terdaftar" };

  const { data, error } = await supabase
    .from("customers")
    .insert({ name: nama, phone, email, dob, address: alamat, pekerjaan, sumber_info, catatan })
    .select("id, name, phone, points, tier, kategori")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "Gagal simpan customer" };

  return { ok: true, customer: { ...data, trx: 0, belanja: 0 } };
}

// Shift gate POS kasir — logika sama dgn /pos/shift, redirect ke dunia kasir.
export async function mulaiShiftKasir(formData: FormData) {
  const supabase = await createClient();
  const branchId = String(formData.get("branchId") ?? "");
  const opening = Number(formData.get("opening_balance")) || 0;
  if (!branchId) redirect(`/kasir/mulai?error=${encodeURIComponent("Pilih cabang dulu")}`);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/kasir/mulai?error=${encodeURIComponent("Sesi kamu habis — masuk ulang.")}`);

  // RLS transaksi POS dilonggarkan untuk demo, jadi cabang dijaga di sini.
  const allowed = await allowedBranchIds(supabase, user.id);
  if (!canUseBranch(allowed, branchId)) {
    redirect(`/kasir/mulai?error=${encodeURIComponent("Kamu tidak bertugas di cabang ini — pilih cabang penempatanmu.")}`);
  }

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

  // Layar kasir hanya boleh menutup shift petshop miliknya sendiri.
  const shift = await bacaShift(supabase, shiftId, "petshop");
  if (!shift) redirect(`/kasir/mulai?error=${encodeURIComponent("Shift tidak ditemukan")}`);

  // Selisih kas wajib punya jurnal — shift jangan ditutup kalau periodenya terkunci.
  const pesanPeriode = await cekPeriode(supabase, hariIniWIB());
  if (pesanPeriode) redirect(`/kasir/tutup?error=${encodeURIComponent(pesanPeriode)}`);

  const hasil = await tutupShift(supabase, { shift: shift!, closing });
  if (!hasil.ok) redirect(`/kasir/tutup?error=${encodeURIComponent(hasil.error)}`);

  // Kasir buta cuma berlaku SEBELUM submit (biar kas fisik dihitung independen).
  // Setelah kas fisik terkunci, kasir boleh lihat breakdown-nya sendiri.
  redirect(`/kasir/tutup/${shiftId}`);
}
