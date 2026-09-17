export type NomorHalamanKasir = number | "…";

export function nomorHalamanKasirTerlihat(total: number, aktif: number): NomorHalamanKasir[] {
  if (total <= 7) return Array.from({ length: Math.max(total, 1) }, (_, index) => index + 1);
  const tengah = Array.from({ length: 5 }, (_, index) => Math.min(Math.max(aktif - 2 + index, 2), total - 1));
  const unik = [...new Set(tengah)].sort((a, b) => a - b);
  const hasil: NomorHalamanKasir[] = [1];
  if ((unik[0] ?? 2) > 2) hasil.push("…");
  hasil.push(...unik);
  if ((unik.at(-1) ?? total - 1) < total - 1) hasil.push("…");
  hasil.push(total);
  return hasil;
}
