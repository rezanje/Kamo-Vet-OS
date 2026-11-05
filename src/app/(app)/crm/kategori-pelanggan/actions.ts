"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { pesanSimpanGagal } from "@/lib/barang";
import { LEVEL_PELANGGAN } from "@/lib/golongan-level";

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

  // Level otomatis (20261107040000): golongan ini dipasang sendiri saat pelanggan mencapai level itu.
  // Golongan level tidak boleh "khusus" — golongan khusus justru yang tidak pernah ditimpa level.
  const levelMentah = String(formData.get("tier_otomatis") ?? "").trim();
  if (levelMentah && !(LEVEL_PELANGGAN as readonly string[]).includes(levelMentah)) {
    redirect(`${BACK}?error=${encodeURIComponent("Level tidak dikenal")}`);
  }
  const tierOtomatis = levelMentah || null;
  const khusus = tierOtomatis ? false : formData.get("khusus") === "on";

  const patch = { nama, diskon_persen: persen, rupiah_per_poin: rupiahPerPoin, tier_otomatis: tierOtomatis, khusus };
  const { error } = id
    ? await supabase.from("customer_categories").update(patch).eq("id", id)
    : await supabase.from("customer_categories").insert(patch);
  if (error) {
    const pesan = /tier_otomatis_uq|duplicate key/i.test(error.message) && tierOtomatis
      ? `Level ${tierOtomatis} sudah dipakai golongan lain. Lepas dulu dari golongan itu.`
      : kolomLevelBelumAda(error) ? "Fitur golongan per level belum aktif di database. Hubungi tim pengembang."
        : pesanSimpanGagal(error.message);
    redirect(`${BACK}?error=${encodeURIComponent(pesan)}`);
  }
  redirect(`${BACK}?success=1${await terapkan(supabase)}`);
}

const kolomLevelBelumAda = (error: { code?: string; message?: string }) =>
  error.code === "42703" || error.code === "PGRST204" || /tier_otomatis|khusus/.test(error.message ?? "");

// Pindahkan pelanggan yang sudah ada ke golongan levelnya (golongan khusus tidak disentuh).
// Gagal di sini tidak membatalkan simpan golongan; jumlah pelanggan yang pindah dilaporkan.
async function terapkan(supabase: Awaited<ReturnType<typeof assertMasterAdmin>>): Promise<string> {
  const { data, error } = await supabase.rpc("terapkan_golongan_level");
  if (error) return `&pindah=gagal`;
  const n = Number(data) || 0;
  return n > 0 ? `&pindah=${n}` : "";
}

// Tidak dihapus: pelanggan & riwayat transaksi masih menunjuk ke sini.
export async function toggleKategoriPelanggan(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "golongan pelanggan");
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) redirect(`${BACK}?error=${encodeURIComponent("Golongan tidak valid")}`);

  const { error } = await supabase.from("customer_categories").update({ is_active: !aktif }).eq("id", id);
  if (error) redirect(`${BACK}?error=${encodeURIComponent(error.message)}`);
  redirect(`${BACK}?success=1${await terapkan(supabase)}`);
}
