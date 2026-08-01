// Validasi nomor HP pelanggan.
//
// Latar: nomor HP adalah kunci yang dipakai semua layar untuk mengenali pelanggan
// lama ("sudah terdaftar? pakai yang ada"). Kalau nomor asal-asalan lolos masuk,
// dedup-nya ikut rusak — data 2026-08-01 punya pelanggan dengan nomor "0", dan
// pemilik yang sama jadi punya dua kartu.

// Minimum 8 digit: nomor Indonesia terpendek yang masuk akal (mis. 021-1234567
// tanpa pemisah = 9 digit). Pemisah, spasi, +62, tanda kurung diabaikan saat
// dihitung — yang dinilai isinya, bukan cara menulisnya.
const MIN_DIGIT = 8;

export function digitHp(phone: string): string {
  return (phone ?? "").replace(/\D/g, "");
}

export function nomorHpValid(phone: string): boolean {
  const d = digitHp(phone);
  if (d.length < MIN_DIGIT) return false;
  // Tolak angka seragam ("0", "00000000", "11111111") — itu isian asal.
  return !/^(\d)\1*$/.test(d);
}

export const PESAN_HP_TIDAK_VALID =
  `No. HP tidak valid — isi minimal ${MIN_DIGIT} angka, bukan angka berulang.`;
