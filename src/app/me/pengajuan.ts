"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyEmployee } from "@/lib/employee";
import { hariIniWIB } from "@/lib/tanggal";

const BACK = "/me";
const gagal = (msg: string): never => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

async function karyawanSaya() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const emp = user ? await getMyEmployee(supabase as never, user.id) : null;
  if (!emp) gagal("Akun belum tertaut ke data karyawan");
  return { supabase, emp: emp! };
}

// Lembur wajib diajukan & disetujui (keputusan boss) — jam pulang saja tidak
// otomatis jadi upah lembur.
export async function ajukanLembur(formData: FormData) {
  const { supabase, emp } = await karyawanSaya();

  const tanggal = String(formData.get("tanggal") ?? "").trim();
  const jam = Number(formData.get("jam"));
  const alasan = String(formData.get("alasan") ?? "").trim() || null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) gagal("Tanggal lembur tidak valid");
  if (tanggal > hariIniWIB()) gagal("Lembur diajukan setelah dikerjakan, bukan untuk tanggal yang belum lewat");
  if (!Number.isFinite(jam) || jam <= 0 || jam > 24) gagal("Jumlah jam lembur tidak wajar");

  const { error } = await supabase.from("overtime_requests")
    .insert({ employee_id: emp.id, tanggal, jam, alasan });
  if (error) {
    gagal(error.message.includes("overtime_requests_employee_id_tanggal_key")
      ? "Lembur untuk tanggal itu sudah pernah diajukan"
      : "Gagal menyimpan pengajuan lembur");
  }
  redirect(`${BACK}?success=lembur`);
}

export async function ajukanKasbon(formData: FormData) {
  const { supabase, emp } = await karyawanSaya();

  const jumlah = Number(formData.get("jumlah"));
  const tenor = Math.floor(Number(formData.get("tenor_bulan")) || 1);
  const alasan = String(formData.get("alasan") ?? "").trim() || null;

  if (!Number.isFinite(jumlah) || jumlah <= 0) gagal("Nominal kasbon tidak valid");
  if (tenor < 1 || tenor > 24) gagal("Lama cicilan antara 1 sampai 24 bulan");

  // Kasbon berjalan yang belum lunas dibatasi satu supaya potongan gaji tidak
  // menumpuk tanpa disadari.
  const { data: berjalan } = await supabase
    .from("cash_advances").select("id")
    .eq("employee_id", emp.id).in("status", ["Menunggu", "Disetujui"]).limit(1);
  if ((berjalan ?? []).length > 0) gagal("Masih ada kasbon yang belum lunas — selesaikan dulu sebelum mengajukan lagi");

  const { error } = await supabase.from("cash_advances")
    .insert({ employee_id: emp.id, tanggal: hariIniWIB(), jumlah, tenor_bulan: tenor, alasan });
  if (error) gagal("Gagal menyimpan pengajuan kasbon");
  redirect(`${BACK}?success=kasbon`);
}

export async function ajukanReimburse(formData: FormData) {
  const { supabase, emp } = await karyawanSaya();

  const tanggal = String(formData.get("tanggal") ?? "").trim() || hariIniWIB();
  const kategori = String(formData.get("kategori") ?? "").trim();
  const jumlah = Number(formData.get("jumlah"));
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;

  if (!kategori) gagal("Pilih kategori pengeluaran");
  if (!Number.isFinite(jumlah) || jumlah <= 0) gagal("Nominal tidak valid");
  if (tanggal > hariIniWIB()) gagal("Tanggal pengeluaran tidak boleh di masa depan");

  const { error } = await supabase.from("reimbursements")
    .insert({ employee_id: emp.id, tanggal, kategori, jumlah, keterangan });
  if (error) gagal("Gagal menyimpan pengajuan reimburse");
  redirect(`${BACK}?success=reimburse`);
}
