"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { normalizeUnit } from "@/lib/satuan-master";
import { pesanSimpanGagal } from "@/lib/barang";

const BACK = "/pos/satuan";

export async function simpanSatuan(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "satuan barang");
  const id = String(formData.get("id") ?? "").trim();
  const nama = normalizeUnit(formData.get("nama"));

  if (!nama) redirect(`${BACK}?error=${encodeURIComponent("Nama satuan wajib diisi")}`);

  const { error } = id
    ? await supabase.from("units").update({ nama }).eq("id", id)
    : await supabase.from("units").insert({ nama });

  redirect(error ? `${BACK}?error=${encodeURIComponent(pesanSimpanGagal(error.message))}` : `${BACK}?success=1`);
}

// Satuan tidak dihapus: barang & riwayat masih menunjuk namanya.
// Nonaktif = tidak muncul lagi di dropdown master barang.
export async function toggleSatuan(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "satuan barang");
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("Satuan tidak valid")}`);

  const { error } = await supabase.from("units").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}
