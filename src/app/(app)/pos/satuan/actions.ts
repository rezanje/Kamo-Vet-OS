"use server";

import { changeMasterLifecycle } from "@/app/(app)/master-data/actions";
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

  const { data, error } = id
    ? await supabase.from("units").update({ nama }).eq("id", id).select("id").maybeSingle()
    : await supabase.from("units").insert({ nama }).select("id").single();

  redirect(error || !data ? `${BACK}?error=${encodeURIComponent(pesanSimpanGagal(error?.message ?? "Data tidak ditemukan atau belum tersimpan"))}` : `${BACK}?success=1`);
}

// Satuan tidak dihapus: barang & riwayat masih menunjuk namanya.
// Nonaktif = tidak muncul lagi di dropdown master barang.
export async function toggleSatuan(formData: FormData) {
  formData.set("entity", "units");
  formData.set("action", formData.get("aktif") === "1" ? "archive" : "activate");
  return changeMasterLifecycle(formData);
}
