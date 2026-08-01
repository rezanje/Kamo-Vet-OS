"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { pesanSimpanGagal } from "@/lib/barang";

const BACK = "/crm/kategori-pelanggan";

export async function simpanKategoriPelanggan(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "golongan pelanggan");
  const id = String(formData.get("id") ?? "").trim();
  const nama = String(formData.get("nama") ?? "").trim().slice(0, 60);
  const persen = Number(formData.get("diskon_persen"));
  const rupiahPerPoin = Number(formData.get("rupiah_per_poin"));

  if (!nama) redirect(`${BACK}?error=${encodeURIComponent("Nama golongan wajib diisi")}`);
  if (!Number.isFinite(persen) || persen < 0 || persen > 100) {
    redirect(`${BACK}?error=${encodeURIComponent("Diskon harus antara 0 dan 100 persen")}`);
  }
  // Nol/negatif akan bikin pembagian poin meledak — ditahan di sini dan di DB.
  if (!Number.isInteger(rupiahPerPoin) || rupiahPerPoin < 1) {
    redirect(`${BACK}?error=${encodeURIComponent("Rp per 1 poin harus bilangan bulat minimal 1")}`);
  }

  const patch = { nama, diskon_persen: persen, rupiah_per_poin: rupiahPerPoin };
  const { error } = id
    ? await supabase.from("customer_categories").update(patch).eq("id", id)
    : await supabase.from("customer_categories").insert(patch);

  redirect(error ? `${BACK}?error=${encodeURIComponent(pesanSimpanGagal(error.message))}` : `${BACK}?success=1`);
}

// Tidak dihapus: pelanggan & riwayat transaksi masih menunjuk ke sini.
export async function toggleKategoriPelanggan(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "golongan pelanggan");
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("Golongan tidak valid")}`);

  const { error } = await supabase.from("customer_categories").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}
