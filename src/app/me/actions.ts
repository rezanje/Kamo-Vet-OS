"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyEmployee } from "@/lib/employee";
import { cekLokasiAbsen, pesanTolakLokasi, type TitikCabang } from "@/lib/lokasi";

function todayJakarta(): string {
  // WIB (UTC+7) date string YYYY-MM-DD.
  const wib = new Date(new Date().getTime() + 7 * 3600 * 1000);
  return wib.toISOString().slice(0, 10);
}
function nowTimeJakarta(): string {
  const wib = new Date(new Date().getTime() + 7 * 3600 * 1000);
  return wib.toISOString().slice(11, 16); // HH:MM
}

// Posisi HP dikirim dari tombol absen; kosong = izin lokasi ditolak atau tidak tersedia.
function bacaPosisi(formData: FormData): { lat: number; lng: number } | null {
  const lat = Number(formData.get("lat"));
  const lng = Number(formData.get("lng"));
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)
    ? { lat, lng }
    : null;
}

// Absen hanya boleh dari lokasi cabang karyawan — kalau cabangnya sudah diberi titik.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pastikanDiLokasi(supabase: any, branchId: string | null, formData: FormData) {
  if (!branchId) return;
  const { data } = await supabase
    .from("branches").select("lat, lng, radius_m").eq("id", branchId).maybeSingle();
  if (!data) return;

  const hasil = cekLokasiAbsen(data as TitikCabang, bacaPosisi(formData));
  if (!hasil.boleh) redirect(`/me?error=${encodeURIComponent(pesanTolakLokasi(hasil))}`);
}

export async function clockIn(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const emp = user ? await getMyEmployee(supabase as never, user.id) : null;
  if (!emp) redirect(`/me?error=${encodeURIComponent("Akun belum tertaut ke data karyawan")}`);

  await pastikanDiLokasi(supabase, emp!.branch_id, formData);

  // upsert: buat / isi jam_masuk untuk hari ini (pola sama dgn hris/absensi).
  await supabase.from("attendance").upsert(
    { employee_id: emp!.id, tanggal: todayJakarta(), jam_masuk: nowTimeJakarta(), status: "Hadir" },
    { onConflict: "employee_id,tanggal" },
  );
  redirect("/me?success=in");
}

export async function clockOut(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const emp = user ? await getMyEmployee(supabase as never, user.id) : null;
  if (!emp) redirect(`/me?error=${encodeURIComponent("Akun belum tertaut ke data karyawan")}`);

  await pastikanDiLokasi(supabase, emp!.branch_id, formData);

  await supabase.from("attendance")
    .update({ jam_pulang: nowTimeJakarta() })
    .eq("employee_id", emp!.id).eq("tanggal", todayJakarta());
  redirect("/me?success=out");
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
