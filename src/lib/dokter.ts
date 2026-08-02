// Dokter penanggung jawab kunjungan.
//
// Dulu namanya diketik bebas di dua layar berbeda, jadi tidak ada cara memastikan
// "Drh. Rena" itu karyawan yang mana — insentif klinik mustahil dihitung. Sekarang
// dipilih dari daftar karyawan; namanya tetap ikut disimpan supaya resep, dokumen,
// dan surat persetujuan yang mencetak `visits.dokter` tidak perlu diubah.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type PilihanDokter = { id: string; nama: string; jabatan: string | null };

export async function daftarDokter(supabase: AnyClient): Promise<PilihanDokter[]> {
  const { data } = await supabase
    .from("employees").select("id, nama, jabatan").eq("status", "Aktif").order("nama");
  const semua = (data ?? []) as PilihanDokter[];
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
