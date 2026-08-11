"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { prosesTerimaPermintaan, type BarisTerima } from "@/lib/terima-permintaan";

// Penerimaan barang klinik — aturannya sama persis dengan penerimaan petshop,
// jadi dua-duanya memakai lib/terima-permintaan.
//
// Versi lama di sini memakai stockIn (menambah stok klinik) TANPA mengurangi
// gudang pengirim, jadi tiap penerimaan menggandakan barang. Juga mengabaikan
// faktor satuan, jadi 1 dus masuk sebagai 1 pcs.
export async function terimaBarangKlinik(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const shift = await getOpenShift(supabase as never, user.id, "klinik");
  if (!shift) redirect("/klinik/shift");

  const requestId = String(formData.get("request_id") ?? "");
  if (!requestId) redirect("/klinik/penerimaan");

  let rows: BarisTerima[] = [];
  try { rows = JSON.parse(String(formData.get("items") ?? "[]")); } catch { rows = []; }

  const hasil = await prosesTerimaPermintaan(supabase, {
    requestId, branchId: shift.branch_id, receivedBy: user.id, rows,
  });
  if (!hasil.ok) {
    redirect(`/klinik/penerimaan?error=${encodeURIComponent(hasil.error)}`);
  }

  revalidatePath("/klinik/penerimaan");
  redirect(`/klinik/penerimaan?success=terima&trm=${hasil.receiptNumber}&selisih=${hasil.selisih}`);
}
