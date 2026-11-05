// Level pelanggan (tier) yang bisa dipetakan ke golongan otomatis — sama dengan
// constraint custcat_tier_otomatis_valid (migrasi 20261107040000).
export const LEVEL_PELANGGAN = ["New", "Bronze", "Silver", "Gold", "Platinum"] as const;
export type LevelPelanggan = (typeof LEVEL_PELANGGAN)[number];

export const labelLevel = (level: string) => (level === "New" ? "Baru (New)" : level);

/** Pesan hasil penerapan golongan level ke pelanggan lama (param `pindah` di URL). */
export function pesanPindahLevel(pindah: string | undefined): string | null {
  if (!pindah) return null;
  if (pindah === "gagal") return "Golongan tersimpan, tetapi pelanggan lama belum dipindah ke golongan levelnya. Simpan sekali lagi untuk mencoba ulang.";
  const n = Number(pindah);
  return Number.isInteger(n) && n > 0 ? `${n.toLocaleString("id-ID")} pelanggan dipindah ke golongan levelnya.` : null;
}
