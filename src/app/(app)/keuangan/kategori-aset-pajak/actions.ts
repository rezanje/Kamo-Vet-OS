"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";

const BASE = "/keuangan/kategori-aset-pajak";
const gagal = (msg: string): never => redirect(`${BASE}?error=${encodeURIComponent(msg)}`);

export async function simpanGolonganPajak(formData: FormData) {
  const supabase = await assertMasterAdmin(BASE, "golongan pajak aset");

  const id = String(formData.get("id") ?? "").trim();
  const nama = String(formData.get("nama") ?? "").trim();
  const umurBulan = Number(formData.get("umur_bulan")) || 0;
  const metode = String(formData.get("metode") ?? "garis_lurus").trim();
  const tarif = Number(formData.get("tarif_persen")) || 0;

  if (!nama) gagal("Nama golongan wajib diisi");
  if (umurBulan <= 0) gagal("Masa manfaat harus lebih dari 0 bulan");
  if (metode !== "garis_lurus" && metode !== "saldo_menurun") gagal("Metode penyusutan tidak dikenal");
  if (metode === "saldo_menurun" && (tarif <= 0 || tarif > 100)) {
    gagal("Metode saldo menurun butuh tarif per tahun antara 0 dan 100");
  }

  const row = { nama, umur_bulan: umurBulan, metode, tarif_persen: tarif };
  const { error } = id
    ? await supabase.from("tax_asset_categories").update(row).eq("id", id)
    : await supabase.from("tax_asset_categories").insert(row);
  if (error) gagal(error.message);

  redirect(`${BASE}?success=1`);
}

export async function toggleGolonganPajak(formData: FormData) {
  const supabase = await assertMasterAdmin(BASE, "golongan pajak aset");
  const id = String(formData.get("id") ?? "").trim();
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) gagal("Golongan tidak valid");

  const { error } = await supabase.from("tax_asset_categories").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BASE}?error=${encodeURIComponent(error.message)}` : `${BASE}?success=1`);
}
