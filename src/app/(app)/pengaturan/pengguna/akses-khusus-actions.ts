"use server";

// E3 (meeting 12 Nov 2026): simpan "Akses khusus akun ini" (Owner saja). Hak & validasi akhir ada di satu fungsi
// database atomik (save_account_access_override) yang juga menulis riwayat; di sini hanya pemeriksaan awal supaya
// pesan untuk Owner jelas. Penolakan dikembalikan sebagai hasil (galat server action disamarkan di produksi).
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { bacaFormAksesAkun, pesanGalatAksesAkun } from "@/lib/akses-akun-form";

export type HasilAksesKhusus = { ok: boolean; message: string };

const BELUM_PASTI = "Hasil simpan belum dapat dipastikan. Muat ulang halaman untuk melihat akses yang berlaku sekarang.";

export async function simpanAksesKhususAkun(form: FormData): Promise<HasilAksesKhusus> {
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return { ok: false, message: "Sesi kamu berakhir. Masuk lagi, lalu ulangi simpan." };
  const { data: actor, error: actorError } = await client.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
  if (actorError) return { ok: false, message: "Status akun kamu belum bisa diperiksa. Tidak ada yang disimpan; coba lagi." };
  if (actor?.role !== "OWNER" || actor.is_active !== true) return { ok: false, message: "Hanya pemilik (Owner) aktif yang boleh mengatur akses khusus akun." };
  const isi = bacaFormAksesAkun(form);
  if (!isi.ok) return isi;
  try {
    const { data, error } = await client.rpc("save_account_access_override", {
      p_profile_id: isi.profileId, p_mode: isi.mode, p_modules: isi.modules, p_reason: isi.reason, p_request_key: isi.requestKey,
    });
    if (error) return { ok: false, message: pesanGalatAksesAkun(error) };
    const hasil = data as { profile_id?: string; changed?: boolean; already_applied?: boolean } | null;
    if (!hasil || hasil.profile_id !== isi.profileId || typeof hasil.changed !== "boolean") return { ok: false, message: BELUM_PASTI };
    // Sidebar/menu akun itu berubah di navigasi berikutnya; halaman ini dimuat ulang dari database.
    revalidatePath("/", "layout");
    if (hasil.already_applied) return { ok: true, message: "Permintaan ini sudah tersimpan sebelumnya. Tampilan dimuat ulang dari data terbaru." };
    if (!hasil.changed) return { ok: true, message: "Tidak ada perubahan: akses akun ini memang sudah seperti itu." };
    return {
      ok: true,
      message: isi.mode === "ikuti"
        ? "Tersimpan. Akun ini kembali mengikuti akses perannya."
        : "Tersimpan. Menu akun ini berubah saat ia membuka halaman berikutnya (tidak perlu keluar-masuk).",
    };
  } catch {
    return { ok: false, message: BELUM_PASTI };
  }
}
