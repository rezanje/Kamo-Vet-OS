// Dokter penanggung jawab kunjungan untuk dokumen cetak klinik.
//
// Permintaan Andri, 29 Oktober 2026: "Di struk ga perlu ditampilkan siapa nama
// tenaga penjualnya. Cukup dokter PJ saja yang ditampilkan." Jadi struk, invoice,
// dan struk rombongan tidak lagi mencetak nama pelaksana per baris; sebagai
// gantinya ada SATU baris kepala "Dokter PJ". Layar kerja staf (pembayaran, rekam
// medis, serah terima rawat inap) tetap menampilkan pelaksana per baris.
//
// Nama diambil dari kartu karyawan yang ditunjuk `visits.doctor_id`. Kunjungan lama
// yang hanya menyimpan nama dokter sebagai teks (`visits.dokter`) memakai teks itu —
// nama yang tercetak tetap nama yang tercatat, bukan rekonstruksi dari data hari ini.
// Kunjungan tanpa keduanya tidak mencetak barisnya sama sekali.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type VisitDokter = { doctor_id?: string | null; dokter?: string | null };

export function namaDokterPJ(
  visit: VisitDokter | null | undefined,
  namaKaryawan?: ReadonlyMap<string, string>,
): string | null {
  if (!visit) return null;
  const dariKartu = visit.doctor_id ? namaKaryawan?.get(visit.doctor_id) ?? null : null;
  return (dariKartu ?? visit.dokter ?? "").trim() || null;
}

/** Nama karyawan untuk `visits.doctor_id` yang dipakai dokumen yang sedang dicetak. */
export async function bacaNamaDokter(
  supabase: AnyClient,
  doctorIds: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(doctorIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("employees").select("id, nama").in("id", ids);
  if (error) throw new Error("Nama dokter penanggung jawab tidak terbaca. Muat ulang sebelum mencetak.");
  return new Map(((data ?? []) as { id: string; nama: string | null }[])
    .filter((row) => (row.nama ?? "").trim())
    .map((row) => [row.id, (row.nama as string).trim()]));
}
