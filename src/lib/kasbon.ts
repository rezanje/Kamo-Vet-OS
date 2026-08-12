// Kasbon karyawan (migrasi 0089) — logika murni, dites di __tests__/kasbon.test.ts.

export const AKUN_PIUTANG_KARYAWAN = "1203";

/** Penanda kasbon yang LAHIR OTOMATIS dari selisih kas, bukan diajukan karyawan.
 *  Dipakai supaya utang ini tidak memblokir hak karyawan mengajukan kasbon sendiri. */
export const ALASAN_SELISIH_KAS = "Selisih kas kurang saat tutup shift";

// Cicilan rata, sisa pembulatan ditaruh di cicilan TERAKHIR supaya jumlah seluruh
// cicilan persis sama dengan kasbonnya (tidak kurang, tidak lebih serupiah pun).
export function jadwalCicilan(jumlah: number, tenor: number): number[] {
  const total = Math.max(0, Math.round(Number(jumlah) || 0));
  const n = Math.max(1, Math.floor(Number(tenor) || 1));
  if (total === 0) return [];

  const dasar = Math.floor(total / n);
  const cicilan = Array.from({ length: n }, () => dasar);
  cicilan[n - 1] = total - dasar * (n - 1);
  return cicilan;
}

export const sisaKasbon = (jumlah: number, sudahDibayar: number): number =>
  Math.max(0, Math.round((Number(jumlah) || 0) - (Number(sudahDibayar) || 0)));

// Potongan untuk satu periode gaji. Tidak pernah melebihi sisa utang — kalau
// karyawan pernah membayar lebih (mis. pelunasan dipercepat), potongan berikutnya
// otomatis mengecil lalu berhenti.
export type KasbonBerjalan = { id?: string; jumlah: number; tenor: number; sudahDibayar: number };

/**
 * Potongan periode ini untuk SEMUA kasbon karyawan, bukan cuma satu.
 *
 * Seorang karyawan bisa punya lebih dari satu utang berjalan — misalnya kasbon
 * yang ia ajukan sendiri, plus utang selisih kas yang lahir otomatis saat tutup
 * shift. Sebelumnya hanya satu yang terbaca dan sisanya diam-diam tidak pernah
 * dipotong.
 */
export function cicilanSemuaKasbon(kasbon: KasbonBerjalan[]): { id?: string; jumlah: number }[] {
  return kasbon
    .map((k) => ({ id: k.id, jumlah: cicilanPeriode(k.jumlah, k.tenor, k.sudahDibayar) }))
    .filter((c) => c.jumlah > 0);
}

/**
 * Cicilan yang BENAR-BENAR bisa dipotong dari gaji periode ini.
 *
 * Gaji bersih tidak boleh negatif, tapi dulu angka cicilannya tetap dilaporkan
 * penuh — jadi sistem mencatat utang lunas dan membebankan gaji yang tidak pernah
 * dibayar. Kalau potongannya melebihi gaji, yang tercatat hanya sebesar yang
 * tertutup gaji; sisanya tetap jadi utang.
 *
 * Dibagi proporsional supaya beberapa kasbon sama-sama kebagian, bukan satu lunas
 * dan sisanya nol.
 */
export function cicilanTertutupGaji(
  cicilan: { id?: string; jumlah: number }[],
  gajiSebelumCicilan: number,
): { id?: string; jumlah: number }[] {
  const total = cicilan.reduce((a, c) => a + c.jumlah, 0);
  const mampu = Math.max(0, Math.round(Number(gajiSebelumCicilan) || 0));
  if (total === 0) return [];
  if (mampu >= total) return cicilan;

  let sisa = mampu;
  return cicilan.map((c, i) => {
    const porsi = i === cicilan.length - 1 ? sisa : Math.floor((c.jumlah / total) * mampu);
    sisa -= porsi;
    return { id: c.id, jumlah: Math.max(0, porsi) };
  }).filter((c) => c.jumlah > 0);
}

export function cicilanPeriode(jumlah: number, tenor: number, sudahDibayar: number): number {
  const sisa = sisaKasbon(jumlah, sudahDibayar);
  if (sisa === 0) return 0;
  const dasar = jadwalCicilan(jumlah, tenor)[0] ?? 0;
  if (dasar <= 0) return sisa;

  // Kalau setelah potongan ini sisanya lebih kecil dari satu cicilan, berarti ini
  // cicilan terakhir — lunasi sekalian. Tanpa ini, sisa pembulatan serupiah
  // menggantung dan kasbon tidak pernah berstatus lunas.
  return sisa - dasar < dasar ? sisa : dasar;
}
