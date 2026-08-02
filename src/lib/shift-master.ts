// Master shift kerja (migrasi 0087) — logika murni, bisa diuji tanpa DB.

export type ShiftDraft = {
  nama: string;
  isLibur: boolean;
  jamMasuk: string;   // "HH:MM", boleh kosong kalau libur
  jamPulang: string;
};

export function validasiShift(d: ShiftDraft): string | null {
  if (!d.nama.trim()) return "Nama shift wajib diisi";
  if (d.isLibur) return null;
  const jam = /^\d{2}:\d{2}$/;
  if (!jam.test(d.jamMasuk)) return "Jam masuk wajib diisi";
  if (!jam.test(d.jamPulang)) return "Jam pulang wajib diisi";
  if (d.jamMasuk === d.jamPulang) return "Jam masuk dan jam pulang tidak boleh sama";
  return null;
}

export const menitDariJam = (hhmm: string): number => {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

// Lama shift dalam menit. Shift yang melewati tengah malam (mis. 21:00–05:00)
// dihitung memutar, bukan jadi angka negatif.
export function durasiShiftMenit(jamMasuk: string, jamPulang: string): number {
  const masuk = menitDariJam(jamMasuk);
  const pulang = menitDariJam(jamPulang);
  return pulang > masuk ? pulang - masuk : 24 * 60 - masuk + pulang;
}

export const jamRingkas = (jamMasuk: string | null, jamPulang: string | null): string =>
  jamMasuk && jamPulang ? `${jamMasuk.slice(0, 5)}–${jamPulang.slice(0, 5)}` : "Libur";
