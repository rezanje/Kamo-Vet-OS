export type BarisDaftarRekamMedis = {
  ownerName: string;
  petName: string;
  phone: string;
};

function normalisasi(value: string) {
  return value.trim().toLocaleLowerCase("id-ID");
}

export function saringDaftarRekamMedis<T extends BarisDaftarRekamMedis>(rows: T[], query: string) {
  const cari = normalisasi(query);
  if (!cari) return rows;

  return rows.filter((row) => [row.ownerName, row.petName, row.phone]
    .some((value) => normalisasi(value).includes(cari)));
}

/** Batas baris daftar rekam medis; sama dengan batas daftar lengkap lain (readCompleteList). */
export const BATAS_DAFTAR_REKAM_MEDIS = 10_000;
const GAGAL_DAFTAR = "Rekam medis belum dapat dimuat lengkap. Coba muat ulang.";

/**
 * Validasi hasil RPC `daftar_rekam_medis` ({jumlah, baris[]}, satu snapshot). Gagal tertutup: bentuk salah,
 * jumlah tidak cocok, atau ID kosong/ganda = error, tidak pernah dianggap kosong atau lengkap.
 */
export function bacaHasilDaftarRekamMedis<T extends { id: string }>(
  hasil: { data: unknown; error: unknown },
  buatError: (pesan: string) => Error,
): T[] {
  const data = hasil.data as { jumlah?: unknown; baris?: unknown } | null;
  if (hasil.error || !data || typeof data !== "object" || Array.isArray(data)) throw buatError(GAGAL_DAFTAR);
  const jumlah = data.jumlah;
  if (typeof jumlah !== "number" || !Number.isSafeInteger(jumlah) || jumlah < 0) throw buatError(GAGAL_DAFTAR);
  if (jumlah > BATAS_DAFTAR_REKAM_MEDIS) {
    throw buatError(`Rekam medis melebihi batas ${BATAS_DAFTAR_REKAM_MEDIS.toLocaleString("id-ID")} baris dan belum dapat ditampilkan lengkap.`);
  }
  if (!Array.isArray(data.baris) || data.baris.length !== jumlah) throw buatError(GAGAL_DAFTAR);
  const ids = new Set<string>();
  for (const row of data.baris as { id?: unknown }[]) {
    if (!row || typeof row !== "object" || typeof row.id !== "string" || !row.id || ids.has(row.id)) throw buatError(GAGAL_DAFTAR);
    ids.add(row.id);
  }
  return data.baris as T[];
}
