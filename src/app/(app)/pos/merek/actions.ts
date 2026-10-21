"use server";

import { changeMasterLifecycle } from "@/app/(app)/master-data/actions";
import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { pesanSimpanGagal } from "@/lib/barang";

const BACK = "/pos/merek";

async function assertBolehKelola() { return assertMasterAdmin(BACK, "master data"); }

export async function simpanMerek(formData: FormData) {
  const supabase = await assertBolehKelola();
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!name) redirect(`${BACK}?error=${encodeURIComponent("Nama merek wajib diisi")}`);

  const { data, error } = id
    ? await supabase.from("brands").update({ name }).eq("id", id).select("id").maybeSingle()
    : await supabase.from("brands").insert({ name }).select("id").single();

  redirect(error || !data ? `${BACK}?error=${encodeURIComponent(pesanSimpanGagal(error?.message ?? "Data tidak ditemukan atau belum tersimpan"))}` : `${BACK}?success=1`);
}

// Merek tidak dihapus: barang lama masih menunjuk ke sini, dan menghapusnya bikin
// merek di riwayat pembelian ikut hilang. Nonaktif = tidak muncul lagi di dropdown.
export async function toggleMerek(formData: FormData) {
  formData.set("entity", "brands");
  formData.set("action", formData.get("aktif") === "1" ? "archive" : "activate");
  return changeMasterLifecycle(formData);
}
