"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { pesanSimpanGagal } from "@/lib/barang";

const BACK = "/pos/merek";

async function assertBolehKelola() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "OWNER" && profile?.role !== "ADMIN") {
    redirect(`${BACK}?error=${encodeURIComponent("Hanya OWNER/ADMIN yang boleh mengubah merek")}`);
  }
  return supabase;
}

export async function simpanMerek(formData: FormData) {
  const supabase = await assertBolehKelola();
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!name) redirect(`${BACK}?error=${encodeURIComponent("Nama merek wajib diisi")}`);

  const { error } = id
    ? await supabase.from("brands").update({ name }).eq("id", id)
    : await supabase.from("brands").insert({ name });

  redirect(error ? `${BACK}?error=${encodeURIComponent(pesanSimpanGagal(error.message))}` : `${BACK}?success=1`);
}

// Merek tidak dihapus: barang lama masih menunjuk ke sini, dan menghapusnya bikin
// merek di riwayat pembelian ikut hilang. Nonaktif = tidak muncul lagi di dropdown.
export async function toggleMerek(formData: FormData) {
  const supabase = await assertBolehKelola();
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("Merek tidak valid")}`);

  const { error } = await supabase.from("brands").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}
