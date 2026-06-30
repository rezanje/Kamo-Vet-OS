"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function simpanExpense(formData: FormData) {
  const supabase = await createClient();
  const branchId = String(formData.get("branchId") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "");
  const kategori = String(formData.get("kategori") ?? "");
  const deskripsi = String(formData.get("deskripsi") ?? "");
  const jumlah = Number(formData.get("jumlah")) || 0;
  const metode = String(formData.get("metode_bayar") ?? "Tunai");

  if (!branchId) redirect(`/pos/expense?error=${encodeURIComponent("Pilih cabang dulu")}`);
  if (!kategori) redirect(`/pos/expense?error=${encodeURIComponent("Pilih kategori dulu")}`);
  if (jumlah <= 0) redirect(`/pos/expense?error=${encodeURIComponent("Jumlah pengeluaran harus lebih dari 0")}`);

  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase.from("expenses").insert({
    branch_id: branchId,
    tanggal: tanggal || undefined,
    kategori,
    deskripsi: deskripsi || null,
    jumlah,
    metode_bayar: metode,
    bukti_url: null, // ponytail: skip upload bukti, kolom dibiarkan null sesuai spec.
    created_by: user?.id ?? null,
  });
  if (error) {
    redirect(`/pos/expense?error=${encodeURIComponent("Gagal menyimpan pengeluaran")}`);
  }
  redirect("/pos/expense?success=1");
}
