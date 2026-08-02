"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { validasiShift } from "@/lib/shift-master";

const BACK = "/hris/shift";
const gagal = (msg: string): never => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

export async function simpanShift(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "master shift");

  const id = String(formData.get("id") ?? "").trim();
  const nama = String(formData.get("nama") ?? "").trim();
  const isLibur = String(formData.get("is_libur") ?? "") === "1";
  const jamMasuk = String(formData.get("jam_masuk") ?? "").trim();
  const jamPulang = String(formData.get("jam_pulang") ?? "").trim();
  const warna = String(formData.get("warna") ?? "#2563eb").trim();
  const branchId = String(formData.get("branch_id") ?? "").trim() || null;

  const salah = validasiShift({ nama, isLibur, jamMasuk, jamPulang });
  if (salah) gagal(salah);

  const row = {
    nama, is_libur: isLibur, warna, branch_id: branchId,
    jam_masuk: isLibur ? null : jamMasuk,
    jam_pulang: isLibur ? null : jamPulang,
  };

  const { error } = id
    ? await supabase.from("work_shifts").update(row).eq("id", id)
    : await supabase.from("work_shifts").insert(row);
  if (error) gagal(error.message);

  redirect(`${BACK}?success=1`);
}

// Shift tidak dihapus: jadwal yang sudah terlanjur memakainya akan ikut hilang.
export async function toggleShift(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "master shift");
  const id = String(formData.get("id") ?? "").trim();
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) gagal("Shift tidak valid");

  const { error } = await supabase.from("work_shifts").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}
