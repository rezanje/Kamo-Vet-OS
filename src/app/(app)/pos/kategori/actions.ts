"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { validateParent, type KategoriRow } from "@/lib/kategori";
import { pesanSimpanGagal } from "@/lib/barang";

const BACK = "/pos/kategori";

export async function simpanKategori(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "kategori barang");
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim().slice(0, 100);
  const parentId = String(formData.get("parent_id") ?? "").trim() || null;

  if (!name) redirect(`${BACK}?error=${encodeURIComponent("Nama kategori wajib diisi")}`);

  // Batas 2 tingkat divalidasi terhadap kondisi DB saat ini, bukan kiriman form.
  const { data } = await supabase.from("item_categories").select("id, name, parent_id, is_active");
  const salah = validateParent(id, parentId, (data ?? []) as KategoriRow[]);
  if (salah) redirect(`${BACK}?error=${encodeURIComponent(salah)}`);

  const { error } = id
    ? await supabase.from("item_categories").update({ name, parent_id: parentId }).eq("id", id)
    : await supabase.from("item_categories").insert({ name, parent_id: parentId });

  redirect(error ? `${BACK}?error=${encodeURIComponent(pesanSimpanGagal(error.message))}` : `${BACK}?success=1`);
}

// Kategori tidak dihapus: barang & laporan lama masih menunjuk ke sini.
export async function toggleKategori(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "kategori barang");
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("Kategori tidak valid")}`);

  const { error } = await supabase.from("item_categories").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}
