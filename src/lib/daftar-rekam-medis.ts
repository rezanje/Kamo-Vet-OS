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

/** Label baris impor tanpa cabang di daftar rekam medis (tampil di setiap cabang). */
export const LABEL_RIWAYAT_IMPOR = "Riwayat impor (semua cabang)";
/** Ukuran satu halaman daftar rekam medis (server). */
export const HALAMAN_REKAM_MEDIS = 50;
/** Batas panjang kata cari; sama dengan batas di RPC `daftar_rekam_medis_halaman`. */
export const MAKS_CARI_REKAM_MEDIS = 100;
export const PESAN_CARI_TERLALU_PANJANG = `Kata cari terlalu panjang (maksimal ${MAKS_CARI_REKAM_MEDIS} huruf).`;

export type RingkasanRekamMedis = { riwayat: number; hewan: number; impor: number };
export type HalamanRekamMedis<T> = { jumlah: number; ringkasan: RingkasanRekamMedis; baris: T[] };

const bilanganSah = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/**
 * Validasi hasil RPC `daftar_rekam_medis_halaman` ({jumlah, ringkasan, batas, offset, baris[]}, satu snapshot).
 * Gagal tertutup: bentuk salah, batas/offset tidak sama dengan yang diminta, panjang halaman tidak cocok dengan
 * jumlah, atau ID kosong/ganda = error, tidak pernah dianggap kosong atau lengkap.
 */
export function bacaHasilHalamanRekamMedis<T extends { id: string }>(
  hasil: { data: unknown; error: unknown },
  diminta: { batas: number; offset: number },
  buatError: (pesan: string) => Error,
): HalamanRekamMedis<T> {
  const data = hasil.data as { jumlah?: unknown; ringkasan?: unknown; batas?: unknown; offset?: unknown; baris?: unknown } | null;
  if (hasil.error || !data || typeof data !== "object" || Array.isArray(data)) throw buatError(GAGAL_DAFTAR);
  const { jumlah, batas, offset } = data;
  const ringkasan = data.ringkasan as Partial<RingkasanRekamMedis> | null;
  if (!bilanganSah(jumlah) || batas !== diminta.batas || offset !== diminta.offset) throw buatError(GAGAL_DAFTAR);
  if (!ringkasan || typeof ringkasan !== "object" || Array.isArray(ringkasan)
    || !bilanganSah(ringkasan.riwayat) || !bilanganSah(ringkasan.hewan) || !bilanganSah(ringkasan.impor)
    || ringkasan.hewan > ringkasan.riwayat || ringkasan.impor > ringkasan.riwayat || jumlah > ringkasan.riwayat) throw buatError(GAGAL_DAFTAR);
  if (!Array.isArray(data.baris) || data.baris.length !== Math.max(0, Math.min(diminta.batas, jumlah - diminta.offset))) {
    throw buatError(GAGAL_DAFTAR);
  }
  const ids = new Set<string>();
  for (const row of data.baris as { id?: unknown }[]) {
    if (!row || typeof row !== "object" || typeof row.id !== "string" || !row.id || ids.has(row.id)) throw buatError(GAGAL_DAFTAR);
    ids.add(row.id);
  }
  return { jumlah, ringkasan: { riwayat: ringkasan.riwayat, hewan: ringkasan.hewan, impor: ringkasan.impor }, baris: data.baris as T[] };
}
