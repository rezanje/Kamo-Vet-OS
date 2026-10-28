"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { angkaIsian } from "@/lib/form-angka";
import { npwpSah } from "@/lib/faktur-pajak";

// Simpan Mode PKP + tarif PPN. Berlaku ke transaksi BARU saja (data lama tidak diubah).
export async function simpanPajak(formData: FormData) {
  const back = "/pengaturan/pajak";
  // Mode PKP & tarif PPN mengubah pembukuan semua transaksi baru: khusus OWNER
  // (RLS company_settings juga hanya mengizinkan OWNER menulis).
  const supabase = await assertRole(back, "pengaturan pajak", ["OWNER"]);
  const mode_pkp = String(formData.get("mode_pkp") ?? "") === "on";
  // Tarif wajib diketik; kolom kosong tidak boleh jadi angka bawaan diam-diam.
  const ppn_rate = angkaIsian(formData, "ppn_rate");

  if (ppn_rate === null) redirect(`${back}?error=${encodeURIComponent("Tarif PPN wajib diisi.")}`);
  if (ppn_rate <= 0 || ppn_rate > 50) redirect(`${back}?error=${encodeURIComponent("Tarif PPN tidak wajar.")}`);

  // Identitas perusahaan dipakai berkas pajak (dan nanti kop dokumen cetak).
  // Boleh dikosongkan — klien belum tentu punya datanya saat ini — tapi kalau
  // NPWP diisi, jumlah digitnya diperiksa: NPWP salah ketik membuat seluruh
  // berkas pajak ditolak, dan itu baru ketahuan saat pelaporan.
  const nama_perusahaan = String(formData.get("nama_perusahaan") ?? "").trim().slice(0, 120) || null;
  const npwp = String(formData.get("npwp") ?? "").trim().slice(0, 30) || null;
  const alamat = String(formData.get("alamat") ?? "").trim().slice(0, 500) || null;
  if (npwp && !npwpSah(npwp)) {
    redirect(`${back}?error=${encodeURIComponent("NPWP harus 15 digit (format lama) atau 16 digit.")}`);
  }

  const { data: { user } } = await supabase.auth.getUser();
  // Tabel satu baris: upsert + cek 1 baris tertulis (update atas baris yang hilang
  // lolos tanpa error padahal tidak menyimpan apa pun).
  const { data, error } = await supabase
    .from("company_settings")
    .upsert({
      id: true, mode_pkp, ppn_rate, nama_perusahaan, npwp, alamat,
      updated_by: user?.id ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: "id" })
    .select("id");
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  if (!Array.isArray(data) || data.length !== 1) {
    redirect(`${back}?error=${encodeURIComponent("Pengaturan pajak tidak tersimpan. Muat ulang lalu coba lagi.")}`);
  }

  revalidatePath(back);
  redirect(`${back}?success=${encodeURIComponent(mode_pkp ? `Mode PKP AKTIF — PPN ${ppn_rate}% mulai berlaku di transaksi baru.` : "Mode PKP nonaktif — transaksi baru tanpa PPN.")}`);
}
