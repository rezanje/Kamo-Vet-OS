"use server";

import { cekEmail, cekPassword, normalEmail, pesanGagalSimpan, PESAN, type HasilAksi } from "@/lib/lupa-password";
import { kirimLinkPemulihan, klienPemulihan } from "@/lib/lupa-password-server";

// Halaman publik (tanpa login). Jawaban "terkirim" sama untuk email terdaftar maupun tidak,
// supaya halaman ini tidak bisa dipakai menebak siapa saja yang punya akun.
export async function mintaLinkReset(_prev: HasilAksi, form: FormData): Promise<HasilAksi> {
  const email = normalEmail(form.get("email"));
  const tolak = cekEmail(email);
  if (tolak) return { ok: false, message: tolak };
  return kirimLinkPemulihan(email);
}

const TOKEN_MAX = 8192;

// Dipanggil dari /login/password-baru dengan token pemulihan dari link email.
export async function simpanPasswordBaru(_prev: HasilAksi, form: FormData): Promise<HasilAksi> {
  const accessToken = String(form.get("access_token") ?? "");
  const refreshToken = String(form.get("refresh_token") ?? "");
  const password = String(form.get("password") ?? "");
  const ulang = String(form.get("password_konfirmasi") ?? "");
  if (!accessToken || !refreshToken || accessToken.length > TOKEN_MAX || refreshToken.length > TOKEN_MAX) {
    return { ok: false, message: PESAN.linkTidakBerlaku };
  }
  const tolak = cekPassword(password, ulang);
  if (tolak) return { ok: false, message: tolak };
  try {
    const client = klienPemulihan();
    const { data, error: sesiError } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (sesiError || !data.session) return { ok: false, message: PESAN.linkTidakBerlaku };
    const { error } = await client.auth.updateUser({ password });
    if (error) {
      console.error("[lupa-password] simpan password gagal", error.code ?? "-", error.status ?? "-");
      return { ok: false, message: pesanGagalSimpan(error) };
    }
    // Sama seperti reset oleh Super Admin: semua perangkat keluar, masuk ulang dengan password baru.
    // Gagal di langkah ini tidak membatalkan password yang sudah tersimpan.
    await client.auth.signOut({ scope: "global" }).catch(() => undefined);
    return { ok: true, message: "Password baru tersimpan." };
  } catch {
    return { ok: false, message: PESAN.gagalSimpan };
  }
}
