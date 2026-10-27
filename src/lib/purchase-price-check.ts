// P04: peringatan (bukan blokir) bila harga beli per satuan dasar menyimpang lebih dari
// 50% dari HPP rata-rata bergerak saat ini. Tanpa HPP (belum ada / nol) tidak ada peringatan.
import { readCompleteList } from "./checked-list";

export const PRICE_DEVIATION_LIMIT = 0.5;

type Num = number | string | null | undefined;
export type StockCostRow = { item_id: string; qty: Num; average_cost?: Num };

const finite = (value: Num) => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/**
 * HPP rata-rata per barang (satuan dasar) dari saldo average tiap gudang yang terbaca.
 * Ditimbang dengan qty positif; bila semua qty nol/negatif, rata-rata biasa dari nilai average
 * yang masih tersimpan. Barang tanpa average > 0 tidak masuk peta (= HPP belum diketahui).
 */
export function itemHppMap(rows: StockCostRow[]): Map<string, number> {
  const acc = new Map<string, { value: number; qty: number; sum: number; n: number }>();
  for (const row of rows) {
    const cost = finite(row.average_cost);
    if (!row.item_id || cost === null || cost <= 0) continue;
    const qty = Math.max(finite(row.qty) ?? 0, 0);
    const a = acc.get(row.item_id) ?? { value: 0, qty: 0, sum: 0, n: 0 };
    a.value += qty * cost; a.qty += qty; a.sum += cost; a.n += 1;
    acc.set(row.item_id, a);
  }
  const out = new Map<string, number>();
  for (const [id, a] of acc) out.set(id, a.qty > 0 ? a.value / a.qty : a.sum / a.n);
  return out;
}

/** Selisih relatif harga per satuan dasar terhadap HPP (0.6 = 60% lebih mahal, -0.6 = 60% lebih murah). */
export function priceDeviation(unitPrice: Num, factor: Num, hpp: Num): number | null {
  const price = finite(unitPrice), f = finite(factor), base = finite(hpp);
  if (price === null || price < 0 || base === null || base <= 0) return null;
  const perBase = price / (f !== null && f > 0 ? f : 1);
  return (perBase - base) / base;
}

/** Teks peringatan untuk satu baris, atau null bila dalam batas / HPP belum diketahui. */
export function priceDeviationWarning(unitPrice: Num, factor: Num, hpp: Num): string | null {
  const deviation = priceDeviation(unitPrice, factor, hpp);
  if (deviation === null || Math.abs(deviation) <= PRICE_DEVIATION_LIMIT) return null;
  const pct = Math.round(Math.abs(deviation) * 100).toLocaleString("id-ID");
  return `Harga per satuan dasar ${pct}% lebih ${deviation > 0 ? "mahal" : "murah"} dari HPP rata-rata saat ini. Periksa satuan dan harga.`;
}

/**
 * HPP rata-rata bergerak per barang, terbatas pada gudang yang boleh dibaca akun ini (RLS stok).
 * Gagal baca = peta kosong: peringatan hanya alat bantu, tidak boleh menghalangi pembelian.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadItemHpp(client: any, itemIds?: string[]): Promise<Map<string, number>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const read = (filter: (query: any) => any) => readCompleteList<StockCostRow & { id: string }>((from, to) => filter(client.from("stock")
    .select("id,item_id,qty,average_cost", { count: "exact" }).not("average_cost", "is", null))
    .order("id").range(from, to), "HPP rata-rata barang", { maxRows: null });
  try {
    if (!itemIds) return itemHppMap(await read(query => query));
    const ids = [...new Set(itemIds.filter(Boolean))];
    const rows: StockCostRow[] = [];
    for (let start = 0; start < ids.length; start += 100) rows.push(...await read(query => query.in("item_id", ids.slice(start, start + 100))));
    return itemHppMap(rows);
  } catch {
    return new Map();
  }
}
