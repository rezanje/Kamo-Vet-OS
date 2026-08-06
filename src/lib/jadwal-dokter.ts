// Jadwal dokter = pembacaan jadwal shift HRIS dari sudut pandang klinik.
//
// Sengaja TIDAK punya tabel sendiri: satu orang tidak boleh punya dua jadwal yang
// bisa berbeda (satu di HRIS, satu di klinik). Jadwalnya tetap diatur di
// HRIS → Jadwal Shift; di sini cuma dibaca dan disaring untuk tenaga medis.

/** Tenaga medis: dokter & paramedis. Grooming/vaksin kadang dipegang paramedis. */
export function isTenagaMedis(e: { nama: string; jabatan?: string | null }): boolean {
  return /dokter|drh|paramedis|perawat/i.test(`${e.jabatan ?? ""} ${e.nama}`);
}

/** Tujuh hari berturut-turut mulai `mulai` (YYYY-MM-DD, WIB). */
export function rentangTujuhHari(mulai: string): { tanggal: string; namaHari: string; hari: number }[] {
  const NAMA_HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const [y, m, d] = mulai.split("-").map(Number);
  return Array.from({ length: 7 }, (_, i) => {
    const t = new Date(y, m - 1, d + i);
    const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    return { tanggal: iso, namaHari: NAMA_HARI[t.getDay()], hari: t.getDate() };
  });
}

export type BarisJadwal = {
  employeeId: string;
  nama: string;
  jabatan: string | null;
  /** tanggal → label shift ("Pagi 08:00–16:00") atau null kalau tidak dijadwalkan. */
  perHari: Record<string, { nama: string; jam: string; libur: boolean } | null>;
};

/**
 * Berapa tenaga medis yang benar-benar masuk pada satu tanggal. Hari libur dan
 * hari tanpa jadwal sama-sama tidak dihitung — keduanya berarti tidak ada orang.
 */
export function jumlahJaga(baris: BarisJadwal[], tanggal: string): number {
  return baris.filter((b) => {
    const s = b.perHari[tanggal];
    return !!s && !s.libur;
  }).length;
}
