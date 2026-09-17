export const BATAS_KATEGORI_KASIR = 12;

export function kategoriKasirTerlihat(
  kategori: string[],
  dibuka: boolean,
  terpilih: string,
  batas = BATAS_KATEGORI_KASIR,
) {
  if (dibuka || kategori.length <= batas) return kategori;

  const ringkas = kategori.slice(0, batas);
  if (!ringkas.includes(terpilih)) ringkas[ringkas.length - 1] = terpilih;
  return ringkas;
}
