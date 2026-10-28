"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { angkaIsian } from "@/lib/form-angka";

const BACK = "/pengaturan/gaji";
const gagal = (msg: string): never => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

export async function simpanAturanGaji(formData: FormData) {
  const supabase = await assertRole(BACK, "aturan gaji", ["OWNER"]);

  // Semua angka wajib diketik (0 boleh). Kolom kosong tidak boleh diam-diam jadi
  // tarif nol yang "sudah diputuskan" pemilik.
  const kolom = ["telat_mulai_menit", "telat_blok_menit", "telat_nominal_per_blok", "telat_maks", "bolos_per_hari", "lembur_per_jam"] as const;
  const isian = Object.fromEntries(kolom.map((k) => [k, angkaIsian(formData, k)])) as Record<(typeof kolom)[number], number | null>;
  if (kolom.some((k) => isian[k] === null)) gagal("Semua angka wajib diisi. Ketik 0 kalau memang tidak ada potongan/lembur.");
  const angka = (k: (typeof kolom)[number]) => isian[k] as number;
  const row = {
    telat_mulai_menit: Math.floor(angka("telat_mulai_menit")),
    telat_blok_menit: Math.floor(angka("telat_blok_menit")),
    telat_nominal_per_blok: angka("telat_nominal_per_blok"),
    telat_maks: angka("telat_maks"),
    bolos_per_hari: angka("bolos_per_hari"),
    lembur_per_jam: angka("lembur_per_jam"),
  };

  if (row.telat_blok_menit <= 0) gagal("Blok menit harus lebih dari 0");
  if (row.telat_mulai_menit < 0) gagal("Batas bawah telat tidak boleh negatif");
  if (Object.values(row).some((v) => v < 0)) gagal("Nominal tidak boleh negatif");
  if (row.telat_maks > 0 && row.telat_maks < row.telat_nominal_per_blok) {
    gagal("Batas atas potongan lebih kecil dari satu blok — potongan jadi tidak masuk akal");
  }

  const { data: { user } } = await supabase.auth.getUser();
  // Tabel satu baris: upsert, bukan update. Update atas baris yang belum ada
  // "berhasil" tanpa menyimpan apa pun — begitu yang terjadi di produksi.
  const { data, error } = await supabase
    .from("payroll_settings")
    .upsert(
      { id: true, ...row, updated_by: user?.id ?? null, updated_at: new Date().toISOString() },
      { onConflict: "id" },
    )
    .select("id");
  if (error) gagal(error.message);
  if (!Array.isArray(data) || data.length !== 1) gagal("Aturan gaji tidak tersimpan. Muat ulang lalu coba lagi.");

  revalidatePath(BACK);
  redirect(`${BACK}?success=1`);
}
