"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { pesanSimpanGagal } from "@/lib/barang";

const BACK = "/keuangan/kategori-aset";

export async function simpanKategoriAset(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "kategori aset");
  const id = String(formData.get("id") ?? "").trim();
  const nama = String(formData.get("nama") ?? "").trim().slice(0, 60);
  const umurBulan = Number(formData.get("umur_bulan"));
  const akunBeban = String(formData.get("akun_beban") ?? "").trim();
  const akunAkumulasi = String(formData.get("akun_akumulasi") ?? "").trim();

  if (!nama) redirect(`${BACK}?error=${encodeURIComponent("Nama kategori wajib diisi")}`);
  if (!Number.isInteger(umurBulan) || umurBulan <= 0) {
    redirect(`${BACK}?error=${encodeURIComponent("Umur penyusutan harus lebih dari 0 bulan")}`);
  }
  if (!akunBeban || !akunAkumulasi) {
    redirect(`${BACK}?error=${encodeURIComponent("Akun beban & akun akumulasi wajib dipilih")}`);
  }

  // Kode akun berasal dari dropdown COA, tetap diverifikasi ada di coa_accounts —
  // jurnal penyusutan gagal total kalau akunnya tidak ada.
  const { data: akun } = await supabase.from("coa_accounts").select("code").in("code", [akunBeban, akunAkumulasi]);
  const kode = new Set((akun ?? []).map((a) => a.code as string));
  if (!kode.has(akunBeban) || !kode.has(akunAkumulasi)) {
    redirect(`${BACK}?error=${encodeURIComponent("Akun yang dipilih tidak ada di daftar akun")}`);
  }

  const patch = { nama, umur_bulan: umurBulan, akun_beban: akunBeban, akun_akumulasi: akunAkumulasi };
  const { error } = id
    ? await supabase.from("asset_categories").update(patch).eq("id", id)
    : await supabase.from("asset_categories").insert(patch);

  redirect(error ? `${BACK}?error=${encodeURIComponent(pesanSimpanGagal(error.message))}` : `${BACK}?success=1`);
}

// Tidak dihapus: aset lama & jurnal penyusutan masih menunjuk ke sini.
export async function toggleKategoriAset(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "kategori aset");
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("Kategori tidak valid")}`);

  const { error } = await supabase.from("asset_categories").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}
