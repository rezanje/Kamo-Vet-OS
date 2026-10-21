"use server";

import { changeMasterLifecycle } from "@/app/(app)/master-data/actions";
import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { pesanSimpanGagal } from "@/lib/barang";

const BACK = "/pembelian/kategori-pemasok";

export async function simpanKategoriPemasok(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "kategori pemasok");
  const id = String(formData.get("id") ?? "").trim();
  const nama = String(formData.get("nama") ?? "").trim().slice(0, 60);

  if (!nama) redirect(`${BACK}?error=${encodeURIComponent("Nama kategori wajib diisi")}`);

  const { data, error } = id
    ? await supabase.from("supplier_categories").update({ nama }).eq("id", id).select("id").maybeSingle()
    : await supabase.from("supplier_categories").insert({ nama }).select("id").single();

  redirect(error || !data ? `${BACK}?error=${encodeURIComponent(pesanSimpanGagal(error?.message ?? "Data tidak ditemukan atau belum tersimpan"))}` : `${BACK}?success=1`);
}

// Tidak dihapus: pemasok lama masih menunjuk ke sini.
export async function toggleKategoriPemasok(formData: FormData) {
  formData.set("entity", "supplier_categories");
  formData.set("action", formData.get("aktif") === "1" ? "archive" : "activate");
  return changeMasterLifecycle(formData);
}
