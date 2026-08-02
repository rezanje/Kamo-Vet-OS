"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";

const BACK = "/hris/jadwal";
const BOLEH = ["OWNER", "ADMIN"];

type Perubahan = { employee_id: string; tanggal: string; shift_id: string | null };

// Papan jadwal disimpan sekali klik: satu daftar perubahan, bukan satu request per sel.
export async function simpanJadwal(formData: FormData) {
  const cabang = String(formData.get("cabang") ?? "").trim();
  const bulan = String(formData.get("bulan") ?? "").trim();
  const kembali = `${BACK}?cabang=${cabang}&bulan=${bulan}`;
  const gagal = (msg: string): never => redirect(`${kembali}&error=${encodeURIComponent(msg)}`);

  const supabase = await assertRole(kembali, "jadwal shift", BOLEH);

  let rows: Perubahan[] = [];
  try {
    rows = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    gagal("Perubahan jadwal tidak terbaca, coba ulangi");
  }
  if (rows.length === 0) redirect(`${kembali}&success=kosong`);

  const { data: { user } } = await supabase.auth.getUser();

  const dihapus = rows.filter((r) => !r.shift_id);
  const diisi = rows.filter((r) => r.shift_id);

  // Hapus per karyawan supaya satu perintah menghapus banyak tanggal sekaligus.
  for (const r of dihapus) {
    const { error } = await supabase
      .from("employee_schedules").delete()
      .eq("employee_id", r.employee_id).eq("tanggal", r.tanggal);
    if (error) gagal(error.message);
  }

  if (diisi.length > 0) {
    const { error } = await supabase.from("employee_schedules").upsert(
      diisi.map((r) => ({
        employee_id: r.employee_id, tanggal: r.tanggal, shift_id: r.shift_id,
        created_by: user?.id ?? null,
      })),
      { onConflict: "employee_id,tanggal" },
    );
    if (error) gagal(error.message);
  }

  redirect(`${kembali}&success=${rows.length}`);
}
