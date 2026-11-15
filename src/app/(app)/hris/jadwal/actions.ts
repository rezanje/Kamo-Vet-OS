"use server";

import { redirect } from "next/navigation";
import { assertHrisManager } from "@/lib/master-guard";
import { hariIniWIB } from "@/lib/tanggal";
import { bacaPapanJadwal } from "@/lib/jadwal-karyawan";
import { bulanSebelumnya, rencanaSalinJadwal, rentangSumber, tanggalBulan, type SelJadwal } from "@/lib/jadwal-salin";

const BACK = "/hris/jadwal";

type Perubahan = { employee_id: string; tanggal: string; shift_id: string | null };

// Papan jadwal disimpan sekali klik: satu daftar perubahan, bukan satu request per sel.
export async function simpanJadwal(formData: FormData) {
  const cabang = String(formData.get("cabang") ?? "").trim();
  const bulan = String(formData.get("bulan") ?? "").trim();
  const kembali = `${BACK}?cabang=${cabang}&bulan=${bulan}`;
  const gagal = (msg: string): never => redirect(`${kembali}&error=${encodeURIComponent(msg)}`);

  const supabase = await assertHrisManager(kembali);

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

// C1: "Salin dari bulan lalu" — pola per hari yang sama (4 minggu sebelumnya) untuk karyawan yang tampil
// di papan cabang ini. Sel yang sudah terisi TIDAK ditimpa kecuali "timpa" dicentang (dan dikonfirmasi di layar).
export async function salinJadwalBulanLalu(formData: FormData) {
  const cabang = String(formData.get("cabang") ?? "").trim();
  const bulan = String(formData.get("bulan") ?? "").trim();
  const timpa = String(formData.get("timpa") ?? "") === "1";
  const kembali = `${BACK}?cabang=${cabang}&bulan=${bulan}`;
  const gagal = (msg: string): never => redirect(`${kembali}&error=${encodeURIComponent(msg)}`);
  if (!cabang || !/^\d{4}-(0[1-9]|1[0-2])$/.test(bulan)) gagal("Cabang dan bulan wajib dipilih");

  const supabase = await assertHrisManager(kembali);
  const { karyawan, shifts } = await bacaPapanJadwal(supabase, cabang, hariIniWIB());
  if (karyawan.length === 0) gagal("Tidak ada karyawan aktif di cabang ini");
  const ids = karyawan.map((k) => k.id);
  const hari = tanggalBulan(bulan);
  const { dari, sampai } = rentangSumber(bulan);

  // Per 20 karyawan (≤ 20 × 37 hari < batas 1.000 baris per permintaan) supaya tidak ada yang terpotong.
  const baca = async (awal: string, akhir: string): Promise<SelJadwal[]> => {
    const hasil: SelJadwal[] = [];
    for (let i = 0; i < ids.length; i += 20) {
      const { data, error } = await supabase.from("employee_schedules").select("employee_id, tanggal, shift_id")
        .in("employee_id", ids.slice(i, i + 20)).gte("tanggal", awal).lte("tanggal", akhir);
      if (error) gagal("Jadwal gagal dibaca, coba lagi");
      hasil.push(...((data ?? []) as SelJadwal[]));
    }
    return hasil;
  };
  const [sumber, sekarang] = await Promise.all([baca(dari, sampai), baca(hari[0], hari[hari.length - 1])]);

  const rencana = rencanaSalinJadwal({
    bulan, karyawan: ids, sumber, sekarang,
    shiftBoleh: new Set(shifts.map((s) => s.id)),
    timpa,
  });
  if (rencana.isi.length === 0) {
    gagal(rencana.dilewati > 0
      ? `Tidak ada yang disalin: ${rencana.dilewati} hari sudah terisi. Centang "Timpa" bila memang mau diganti.`
      : `Jadwal ${bulanSebelumnya(bulan)} masih kosong, tidak ada yang bisa disalin.`);
  }

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("employee_schedules").upsert(
    rencana.isi.map((r) => ({ ...r, created_by: user?.id ?? null })),
    { onConflict: "employee_id,tanggal" },
  );
  if (error) gagal(error.message);

  const catatan = [`${rencana.isi.length} hari tersalin dari ${bulanSebelumnya(bulan)}.`];
  if (rencana.dilewati > 0) catatan.push(`${rencana.dilewati} hari dilewati karena sudah terisi.`);
  if (rencana.shiftTidakAktif > 0) catatan.push(`${rencana.shiftTidakAktif} hari dilewati karena shift-nya sudah nonaktif.`);
  redirect(`${kembali}&success=salin&info=${encodeURIComponent(catatan.join(" "))}`);
}
