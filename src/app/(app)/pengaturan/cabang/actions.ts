"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { validasiKoordinat } from "@/lib/lokasi";

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
