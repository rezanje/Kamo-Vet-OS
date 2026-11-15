"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyEmployee } from "@/lib/employee";
import { hariIniWIB } from "@/lib/tanggal";
import {
  BUCKET_FOTO_ABSEN, MAKS_FOTO_BYTE, pathFotoAbsen, pesanAbsen, pesanSuksesAbsen, pesanUnggahFoto,
  type HasilAbsen, type JenisAbsen,
} from "@/lib/absensi-mandiri";

const gagalMe = (pesan: string): never => redirect(`/me?error=${encodeURIComponent(pesan)}`);

// Posisi HP dikirim dari tombol absen; kosong = izin lokasi ditolak atau tidak tersedia.
// Server (fungsi database) yang memutuskan boleh/tidaknya, bukan HP.
function bacaPosisi(formData: FormData): { lat: number; lng: number } | null {
  const latIsi = String(formData.get("lat") ?? "").trim();
  const lngIsi = String(formData.get("lng") ?? "").trim();
  if (!latIsi || !lngIsi) return null;
  const lat = Number(latIsi);
  const lng = Number(lngIsi);
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
}

// C1: absen masuk/pulang mandiri. Jam TIDAK dikirim dari aplikasi — fungsi database memakai jam server.
// Urutan: unggah selfie (bucket privat, folder milik karyawan sendiri) → panggil absen_mandiri().
// Absen yang ditolak (mis. di luar radius) meninggalkan fotonya di bucket sebagai jejak percobaan.
export async function absenMandiri(formData: FormData) {
  const jenis: JenisAbsen = String(formData.get("jenis") ?? "") === "pulang" ? "pulang" : "masuk";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) gagalMe("Sesi login sudah berakhir. Silakan masuk lagi");
  const emp = await getMyEmployee(supabase as never, user!.id);
  if (!emp) gagalMe("Akun belum tertaut ke data karyawan");

  const foto = formData.get("foto");
  if (!(foto instanceof Blob) || foto.size === 0) gagalMe("Foto selfie wajib diambil dulu sebelum absen.");
  const file = foto as Blob;
  if (file.size > MAKS_FOTO_BYTE) gagalMe("Foto terlalu besar. Ambil ulang fotonya.");
  if (file.type && !/^image\/(jpeg|jpg)$/i.test(file.type)) gagalMe("Format foto tidak didukung. Ambil ulang fotonya.");

  const path = pathFotoAbsen(emp!.id, hariIniWIB(), jenis, randomUUID());
  const { error: unggahError } = await supabase.storage.from(BUCKET_FOTO_ABSEN)
    .upload(path, file, { contentType: "image/jpeg", upsert: false });
  if (unggahError) gagalMe(pesanUnggahFoto(unggahError));

  const posisi = bacaPosisi(formData);
  const { data, error } = await supabase.rpc("absen_mandiri", {
    p_jenis: jenis, p_lat: posisi?.lat ?? null, p_lng: posisi?.lng ?? null, p_foto: path,
  });
  if (error) gagalMe(pesanAbsen(error));

  const pesan = pesanSuksesAbsen(data as HasilAbsen);
  redirect(`/me?success=${jenis === "masuk" ? "in" : "out"}&info=${encodeURIComponent(pesan)}`);
}

// C1: pengajuan koreksi absen (lupa absen / foto gagal / lokasi gagal) → disetujui OWNER/ADMIN di /hris/pengajuan.
export async function ajukanKoreksiAbsen(formData: FormData) {
  const tanggal = String(formData.get("tanggal") ?? "").trim();
  const jamMasuk = String(formData.get("jam_masuk") ?? "").trim() || null;
  const jamPulang = String(formData.get("jam_pulang") ?? "").trim() || null;
  const kategori = String(formData.get("kategori") ?? "").trim();
  const alasan = String(formData.get("alasan") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) gagalMe("Tanggal koreksi wajib diisi");
  const jam = /^([01]\d|2[0-3]):[0-5]\d$/;
  if ((jamMasuk && !jam.test(jamMasuk)) || (jamPulang && !jam.test(jamPulang))) gagalMe("Format jam tidak valid");
  if (!jamMasuk && !jamPulang) gagalMe("Isi jam masuk dan/atau jam pulang yang benar");
  if (alasan.length < 3) gagalMe("Alasan koreksi wajib diisi");

  const supabase = await createClient();
  const { error } = await supabase.rpc("ajukan_koreksi_absen", {
    p_tanggal: tanggal, p_jam_masuk: jamMasuk, p_jam_pulang: jamPulang, p_kategori: kategori, p_alasan: alasan,
  });
  if (error) gagalMe(pesanAbsen(error));
  redirect("/me?success=koreksi");
}

export async function ajukanCutiPribadi(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const emp = user ? await getMyEmployee(supabase as never, user.id) : null;
  if (!emp) redirect(`/me?error=${encodeURIComponent("Akun belum tertaut ke data karyawan")}`);

  const jenis = String(formData.get("jenis") ?? "").trim();
  const tanggalMulai = String(formData.get("tanggal_mulai") ?? "").trim();
  const tanggalSelesai = String(formData.get("tanggal_selesai") ?? "").trim() || null;
  const durasi = formData.get("durasi") ? Number(formData.get("durasi")) : null;
  const alasan = String(formData.get("alasan") ?? "").trim() || null;
  if (!jenis || !tanggalMulai) redirect(`/me?error=${encodeURIComponent("Jenis & tanggal mulai wajib diisi")}`);

  const { error } = await supabase.from("leave_requests").insert({
    employee_id: emp!.id, jenis, tanggal_mulai: tanggalMulai, tanggal_selesai: tanggalSelesai,
    durasi, alasan, status: "Menunggu",
  });
  if (error) redirect(`/me?error=${encodeURIComponent("Gagal simpan pengajuan")}`);
  redirect("/me?success=cuti");
}

export async function ubahPasswordPribadi(formData: FormData) {
  const passwordLama = String(formData.get("password_lama") ?? "");
  const passwordBaru = String(formData.get("password_baru") ?? "");
  const konfirmasi = String(formData.get("konfirmasi_password") ?? "");
  const gagal = (pesan: string): never => redirect(`/me?error=${encodeURIComponent(pesan)}`);

  if (passwordBaru.length < 8) gagal("Password baru minimal 8 karakter");
  if (passwordBaru !== konfirmasi) gagal("Konfirmasi password baru tidak cocok");
  if (!passwordLama) gagal("Password saat ini wajib diisi");

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) gagal("Sesi login sudah berakhir. Silakan masuk lagi");

  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("is_active").eq("id", user!.id).maybeSingle();
  if (profileError || !profile || profile.is_active !== true) gagal("Akun belum aktif");

  const hasEmailPasswordIdentity = Boolean(user!.email && user!.email_confirmed_at && user!.identities?.some((identity) => identity.provider === "email"));
  if (!hasEmailPasswordIdentity) gagal("Akun ini belum bisa diverifikasi dengan password");
  const { data: reauthenticated, error: reauthError } = await supabase.auth.signInWithPassword({
    email: user!.email!,
    password: passwordLama,
  });
  if (reauthError || reauthenticated.user?.id !== user!.id) gagal("Password saat ini salah");

  const { error } = await supabase.auth.updateUser({ password: passwordBaru });
  if (error) gagal("Password baru gagal disimpan");
  redirect("/me?success=password");
}
