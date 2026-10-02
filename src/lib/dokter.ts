// Dokter penanggung jawab kunjungan.
//
// Dulu namanya diketik bebas di dua layar berbeda, jadi tidak ada cara memastikan
// "Drh. Rena" itu karyawan yang mana — insentif klinik mustahil dihitung. Sekarang
// dipilih dari daftar karyawan; namanya tetap ikut disimpan supaya resep, dokumen,
// dan surat persetujuan yang mencetak `visits.dokter` tidak perlu diubah.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type PilihanDokter = {
  id: string;
  nama: string;
  jabatan: string | null;
  jaga?: boolean;
};

/**
 * `tanggal` diisi → tiap pilihan ditandai apakah orangnya memang dijadwalkan masuk
 * hari itu (jadwal shift HRIS). Petugas pendaftaran jadi tidak menugaskan pasien
 * ke dokter yang sedang libur. Tandanya informasi, bukan larangan — dokter
 * pengganti tetap boleh dipilih.
 */
export async function daftarDokter(
  supabase: AnyClient,
  konteks?: { tanggal?: string; branchId?: string | null },
): Promise<PilihanDokter[]> {
  const { data } = await supabase
    .from("employee_directory")
    .select("id, nama, jabatan, branch_id, assigned_branch_ids")
    .eq("status", "Aktif")
    .order("nama");
  const semua = (data ?? []) as (PilihanDokter & {
    branch_id: string | null;
    assigned_branch_ids: string[];
  })[];

  if (konteks?.branchId && semua.length) {
    for (let i = semua.length - 1; i >= 0; i--) {
      if (
        !semua[i].assigned_branch_ids?.includes(konteks.branchId) &&
        semua[i].branch_id !== konteks.branchId
      )
        semua.splice(i, 1);
    }
  }

  if (konteks?.tanggal && semua.length) {
    const { data: jadwal } = await supabase
      .from("employee_schedule_directory")
      .select("employee_id, is_libur")
      .eq("tanggal", konteks.tanggal)
      .in(
        "employee_id",
        semua.map((e) => e.id),
      );
    const jaga = new Set<string>(
      ((jadwal ?? []) as { employee_id: string; is_libur: boolean }[])
        .filter((r) => !r.is_libur)
        .map((r) => r.employee_id),
    );
    for (const e of semua) e.jaga = jaga.has(e.id);
  }

  // Dokter didahulukan, tapi staf lain tetap bisa dipilih — grooming & vaksinasi
  // kadang ditangani paramedis.
  const dokter = semua.filter((e) =>
    /dokter|drh/i.test(`${e.jabatan ?? ""} ${e.nama}`),
  );
  const lain = semua.filter((e) => !dokter.includes(e));
  return [...dokter, ...lain];
}

/** Ubah pilihan dropdown jadi pasangan (id, nama) yang siap disimpan ke `visits`. */
export async function resolveDokter(
  supabase: AnyClient,
  doctorId: string | null,
): Promise<{ doctorId: string | null; nama: string | null }> {
  if (!doctorId) return { doctorId: null, nama: null };
  const { data } = await supabase
    .from("employee_directory")
    .select("id, nama")
    .eq("id", doctorId)
    .maybeSingle();
  if (!data) return { doctorId: null, nama: null };
  return { doctorId: data.id as string, nama: data.nama as string };
}
