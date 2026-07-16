// Bahan baku racikan (BOM line). harga = sell_price snapshot per satuan.
export type RacikanIngredient = {
  item_id: string;
  nama: string;
  qty: number;    // dosis
  satuan: string;
  harga: number;  // sell_price per satuan
};

const safe = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

// Total racikan = Σ(harga × dosis). Tanpa jasa/markup (spec §3).
export function racikanTotal(ings: RacikanIngredient[]): number {
  return ings.reduce((a, i) => a + safe(i.harga) * safe(i.qty), 0);
}
