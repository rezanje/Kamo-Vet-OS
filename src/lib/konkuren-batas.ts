/**
 * Jalankan `kerja` untuk setiap butir dengan paling banyak `batas` pekerjaan sekaligus.
 * Hasil tetap berurutan seperti `butir`. Kegagalan pertama menghentikan butir yang belum
 * dimulai dan dilempar ulang, jadi pembacaan laporan tetap gagal-tertutup.
 * Dipakai laporan yang membaca banyak kelompok id kecil (per 100) supaya tidak satu per satu.
 */
export async function petaBerbatas<T, R>(butir: readonly T[], batas: number, kerja: (butir: T, indeks: number) => Promise<R>): Promise<R[]> {
  const hasil = new Array<R>(butir.length);
  let berikut = 0;
  let gagal = false;
  async function pekerja() {
    while (!gagal && berikut < butir.length) {
      const indeks = berikut++;
      try { hasil[indeks] = await kerja(butir[indeks], indeks); } catch (error) { gagal = true; throw error; }
    }
  }
  const jumlah = Math.max(1, Math.min(Math.floor(batas) || 1, butir.length));
  await Promise.all(Array.from({ length: butir.length ? jumlah : 0 }, pekerja));
  return hasil;
}

/** Batas bersama untuk pembacaan laporan: cukup cepat, tidak membanjiri database. */
export const BATAS_BACA_LAPORAN = 6;
