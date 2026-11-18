import { readReportRows } from "./hpp-reports-server";
import { BATAS_BACA_LAPORAN, petaBerbatas } from "./konkuren-batas";

type Hasil<T> = { data: T[] | null; error: { message: string } | null; count: number | null };

export function potongKelompok<T>(butir: readonly T[], ukuran = 100): T[][] {
  const hasil: T[][] = [];
  for (let i = 0; i < butir.length; i += ukuran) hasil.push(butir.slice(i, i + ukuran));
  return hasil;
}

/**
 * Baris anak (item) untuk kumpulan induk (invoice/struk) yang sudah dibaca. Dulu laporan membaca anak lewat
 * satu query gabungan anak x induk per halaman 500: tiap halaman menghitung ulang seluruh gabungan dan cek
 * hak akses cabang (RLS) per baris, jadi makin lama makin berat dan melewati batas 8 detik database.
 * Sekarang anak dibaca per kelompok 100 id induk (≤ BATAS_BACA_LAPORAN bersamaan). Hasil diurutkan menurut id
 * baris anak, sama dengan `order("id")` pada query gabungan lama (urutan dipakai untuk alokasi neto per dokumen).
 * Setiap kelompok tetap memakai pembaca lengkap (hitungan pasti + identitas unik), jadi gagal-tertutup.
 */
export async function bacaAnakPerInduk<T extends { id: string }>(
  indukIds: Iterable<string>,
  baca: (ids: string[], awal: number, ujung: number) => PromiseLike<Hasil<T>>,
): Promise<T[]> {
  const ids = [...new Set(indukIds)];
  const kelompok = await petaBerbatas(potongKelompok(ids), BATAS_BACA_LAPORAN,
    batch => readReportRows<T>((awal, ujung) => baca(batch, awal, ujung)));
  return kelompok.flat().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
