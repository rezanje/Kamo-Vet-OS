// Dokter penanggung jawab kunjungan.
//
// Dulu namanya diketik bebas di dua layar berbeda, jadi tidak ada cara memastikan
// "Drh. Rena" itu karyawan yang mana — insentif klinik mustahil dihitung. Sekarang
// dipilih dari daftar karyawan; namanya tetap ikut disimpan supaya resep, dokumen,
// dan surat persetujuan yang mencetak `visits.dokter` tidak perlu diubah.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type PilihanDokter = { id: string; nama: string; jabatan: string | null; jaga?: boolean };

/**
 * `tanggal` diisi → tiap pilihan ditandai apakah orangnya memang dijadwalkan masuk
 * hari itu (jadwal shift HRIS). Petugas pendaftaran jadi tidak menugaskan pasien
 * ke dokter yang sedang libur. Tandanya informasi, bukan larangan — dokter
 * pengganti tetap boleh dipilih.
 */
export async function daftarDokter(
  supabase: AnyClient,
  konteks?: { tanggal?: string },
): Promise<PilihanDokter[]> {
  const { data } = await supabase
    .from("employees").select("id, nama, jabatan").eq("status", "Aktif").order("nama");
  const semua = (data ?? []) as PilihanDokter[];

  if (konteks?.tanggal && semua.length) {
    const { data: jadwal } = await supabase
      .from("employee_schedules")
      .select("employee_id, work_shifts(is_libur)")
      .eq("tanggal", konteks.tanggal)
      .in("employee_id", semua.map((e) => e.id));
    type Row = { employee_id: string; work_shifts: { is_libur: boolean } | { is_libur: boolean }[] | null };
    const jaga = new Set<string>();
    for (const r of (jadwal ?? []) as Row[]) {
      const s = Array.isArray(r.work_shifts) ? r.work_shifts[0] : r.work_shifts;
      if (s && !s.is_libur) jaga.add(r.employee_id);
    }
    for (const e of semua) e.jaga = jaga.has(e.id);
  }

  // Dokter didahulukan, tapi staf lain tetap bisa dipilih — grooming & vaksinasi
  // kadang ditangani paramedis.
  const dokter = semua.filter((e) => /dokter|drh/i.test(`${e.jabatan ?? ""} ${e.nama}`));
  const lain = semua.filter((e) => !dokter.includes(e));
  return [...dokter, ...lain];
}

/** Ubah pilihan dropdown jadi pasangan (id, nama) yang siap disimpan ke `visits`. */
export async function resolveDokter(
  supabase: AnyClient,
  doctorId: string | null,
): Promise<{ doctorId: string | null; nama: string | null }> {
  if (!doctorId) return { doctorId: null, nama: null };
  const { data } = await supabase.from("employees").select("id, nama").eq("id", doctorId).maybeSingle();
  if (!data) return { doctorId: null, nama: null };
  return { doctorId: data.id as string, nama: data.nama as string };
}
