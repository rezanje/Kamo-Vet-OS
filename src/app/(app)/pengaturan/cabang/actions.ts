"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { validasiKoordinat } from "@/lib/lokasi";
import { isGroomingOutlet } from "@/lib/grooming-requirements";

const BACK = "/pengaturan/cabang";
const gagal = (msg: string): never => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

// Titik lokasi cabang untuk absen berlokasi (fase 2). Dikosongkan = pengecekan
// lokasi mati untuk cabang itu dan absen jalan seperti biasa.
export async function simpanLokasiCabang(formData: FormData) {
  const supabase = await assertRole(BACK, "lokasi cabang", ["OWNER", "ADMIN"]);

  const id = String(formData.get("id") ?? "").trim();
  const latRaw = String(formData.get("lat") ?? "").trim();
  const lngRaw = String(formData.get("lng") ?? "").trim();
  const radius = Math.floor(Number(formData.get("radius_m")) || 0);

  if (!id) gagal("Cabang tidak valid");
  if (radius <= 0) gagal("Radius harus lebih dari 0 meter");

  const kosong = latRaw === "" && lngRaw === "";
  if (!kosong) {
    const salah = validasiKoordinat(Number(latRaw), Number(lngRaw));
    if (salah) gagal(salah);
  }

  const { error } = await supabase.from("branches").update({
    lat: kosong ? null : Number(latRaw),
    lng: kosong ? null : Number(lngRaw),
    radius_m: radius,
  }).eq("id", id);
  if (error) gagal(error.message);

  redirect(`${BACK}?success=1`);
}

export async function simpanAturanGroomingCabang(formData: FormData) {
  const supabase = await assertRole(BACK, "aturan grooming cabang", ["OWNER", "ADMIN"]);
  const branchId = String(formData.get("id") ?? "").trim();
  const choice = String(formData.get("doctor_required") ?? "");
  if (!branchId || !["1", "0"].includes(choice)) gagal("Aturan grooming cabang tidak valid");
  const { data: branch, error: branchError } = await supabase.from("branches").select("type").eq("id", branchId).maybeSingle();
  if (branchError || !branch || !isGroomingOutlet(branch.type)) gagal("Cabang ini tidak melayani Grooming di outlet");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return gagal("Sesi akun tidak tersedia");
  const { data: existing, error: readError } = await supabase.from("branch_grooming_rules")
    .select("branch_id").eq("branch_id", branchId).maybeSingle();
  if (readError) gagal("Aturan grooming belum dapat diperiksa. Coba muat ulang.");
  const next = { doctor_required: choice === "1", updated_by: user.id, updated_at: new Date().toISOString() };
  const { error } = existing
    ? await supabase.from("branch_grooming_rules").update(next).eq("branch_id", branchId)
    : await supabase.from("branch_grooming_rules").insert({ branch_id: branchId, ...next });
  if (error) gagal("Aturan grooming belum dapat disimpan. Coba muat ulang.");
  redirect(`${BACK}?success=grooming`);
}
