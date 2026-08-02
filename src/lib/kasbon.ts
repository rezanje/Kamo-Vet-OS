// Kasbon karyawan (migrasi 0089) — logika murni, dites di __tests__/kasbon.test.ts.

export const AKUN_PIUTANG_KARYAWAN = "1203";

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
