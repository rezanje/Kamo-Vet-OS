export type BarisBahanRacikan = {
  id: string;
  code: string;
  name: string;
  kategori: string;
  category_id?: string | null;
  sell_price: number;
  is_compound_material: boolean;
};

export type FilterBahanRacikan = { q: string; kategori: string; categoryIds?: string[] };

export function filterBahanRacikan<T extends BarisBahanRacikan>(rows: T[], filter: FilterBahanRacikan): T[] {
  const q = filter.q.trim().toLowerCase();
  return rows.filter((row) => {
    const kategoriCocok = filter.kategori === "__selected__"
      ? row.is_compound_material
      : filter.categoryIds ? filter.categoryIds.includes(row.category_id ?? "")
      : !filter.kategori || row.kategori === filter.kategori;
    const teksCocok = !q || row.name.toLowerCase().includes(q) || row.code.toLowerCase().includes(q);
    return kategoriCocok && teksCocok;
  });
}

export function idsBahanTerlihat<T extends BarisBahanRacikan>(rows: T[], filter: FilterBahanRacikan): string[] {
  return filterBahanRacikan(rows, filter).map((row) => row.id);
}
