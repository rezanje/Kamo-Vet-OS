"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { pesanSimpanGagal } from "@/lib/barang";

const BACK = "/pembelian/kategori-pemasok";

export async function simpanKategoriPemasok(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "kategori pemasok");
  const id = String(formData.get("id") ?? "").trim();
  const nama = String(formData.get("nama") ?? "").trim().slice(0, 60);

  if (!nama) redirect(`${BACK}?error=${encodeURIComponent("Nama kategori wajib diisi")}`);

  const { error } = id
    ? await supabase.from("supplier_categories").update({ nama }).eq("id", id)
    : await supabase.from("supplier_categories").insert({ nama });

  redirect(error ? `${BACK}?error=${encodeURIComponent(pesanSimpanGagal(error.message))}` : `${BACK}?success=1`);
}

// Tidak dihapus: pemasok lama masih menunjuk ke sini.
export async function toggleKategoriPemasok(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "kategori pemasok");
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("Kategori tidak valid")}`);

  const { error } = await supabase.from("supplier_categories").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}
