// P04: peringatan (bukan blokir) bila harga beli per satuan dasar menyimpang lebih dari
// 50% dari HPP rata-rata bergerak saat ini. Tanpa HPP (belum ada / nol) tidak ada peringatan.
// Baris berharga 0/kosong (bonus) dilewati.
//
// Dicek di SERVER saat simpan (server action PO/faktur): HPP tidak pernah dikirim ke browser,
// karena nilai HPP hanya boleh dilihat OWNER/FINANCE. Persentase pun hanya untuk OWNER/FINANCE.
import { readCompleteList } from "./checked-list";

export const PRICE_DEVIATION_LIMIT = 0.5;
/** Nilai field form yang menandakan pengguna sudah membaca peringatan dan tetap menyimpan. */
export const PRICE_CONFIRM_FIELD = "konfirmasi_harga";

type Num = number | string | null | undefined;
export type StockCostRow = { item_id: string; qty: Num; average_cost?: Num };
export type PriceLine = { item_id: string | null | undefined; harga: Num; factor: Num };
export type Deviation = { itemId: string; deviation: number };

const finite = (value: Num) => {
  const n = typeof value === "string" ? (value.trim() === "" ? null : Number(value)) : value;
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

/**
 * Selisih relatif harga per satuan dasar terhadap HPP (0.6 = 60% lebih mahal, -0.6 = 60% lebih murah).
 * null = tidak dinilai: HPP tidak diketahui/nol, atau harga 0/kosong (baris bonus).
 */
export function priceDeviation(unitPrice: Num, factor: Num, hpp: Num): number | null {
  const price = finite(unitPrice), f = finite(factor), base = finite(hpp);
  if (price === null || price <= 0 || base === null || base <= 0) return null;
  const perBase = price / (f !== null && f > 0 ? f : 1);
  return (perBase - base) / base;
}

/** Baris yang menyimpang > 50%, satu entri per barang (simpangan terbesar). */
export function deviatingLines(lines: PriceLine[], hpp: Map<string, number>): Deviation[] {
  const worst = new Map<string, number>();
  for (const line of lines) {
    if (!line.item_id) continue;
    const deviation = priceDeviation(line.harga, line.factor, hpp.get(line.item_id));
    if (deviation === null || Math.abs(deviation) <= PRICE_DEVIATION_LIMIT) continue;
    const prior = worst.get(line.item_id);
    if (prior === undefined || Math.abs(deviation) > Math.abs(prior)) worst.set(line.item_id, deviation);
  }
  return [...worst].map(([itemId, deviation]) => ({ itemId, deviation }));
}

/** Pesan untuk pengguna. Persentase hanya untuk peran yang boleh melihat HPP. */
export function priceWarningMessage(rows: Deviation[], names: Map<string, string>, showPercent: boolean): string | null {
  if (!rows.length) return null;
  const parts = rows.map(row => {
    const name = names.get(row.itemId) ?? "Barang";
    if (!showPercent) return name;
    const pct = Math.round(Math.abs(row.deviation) * 100).toLocaleString("id-ID");
    return `${name} (${pct}% lebih ${row.deviation > 0 ? "mahal" : "murah"})`;
  });
  const head = showPercent ? "Harga beli per satuan dasar menyimpang lebih dari 50% dari HPP rata-rata"
    : "Harga jauh berbeda dari harga pokok rata-rata, periksa ulang";
  return `${head}: ${parts.join(", ")}. Periksa satuan dan harga, lalu centang konfirmasi untuk tetap menyimpan.`;
}

/** HPP rata-rata bergerak untuk barang yang diminta saja, terbatas pada gudang yang boleh dibaca (RLS stok). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadItemHpp(client: any, itemIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(itemIds.filter(Boolean))];
  const rows: StockCostRow[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    rows.push(...await readCompleteList<StockCostRow & { id: string }>((from, to) => client.from("stock")
      .select("id,item_id,qty,average_cost", { count: "exact" }).in("item_id", ids.slice(start, start + 100))
      .not("average_cost", "is", null).order("id").range(from, to), "HPP rata-rata barang", { maxRows: null }));
  }
  return itemHppMap(rows);
}

/**
 * Cek P04 sebelum simpan. Mengembalikan pesan peringatan (dan dokumen TIDAK boleh disimpan) bila ada
 * baris menyimpang dan form belum membawa konfirmasi. Gagal membaca HPP = tidak ada peringatan:
 * peringatan alat bantu, tidak boleh menghalangi pembelian.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function priceCheckBeforeSave(client: any, formData: FormData, lines: PriceLine[]): Promise<string | null> {
  if (formData.get(PRICE_CONFIRM_FIELD) === "1") return null;
  const priced = lines.filter(line => line.item_id && (finite(line.harga) ?? 0) > 0);
  if (!priced.length) return null;
  try {
    const rows = deviatingLines(priced, await loadItemHpp(client, priced.map(line => line.item_id as string)));
    if (!rows.length) return null;
    const [{ data: { user } }, { data: items }] = await Promise.all([
      client.auth.getUser(),
      client.from("items").select("id,name").in("id", rows.map(row => row.itemId)),
    ]);
    const { data: profile } = await client.from("profiles").select("role,is_active").eq("id", user?.id ?? "").maybeSingle();
    const showPercent = profile?.is_active === true && ["OWNER", "FINANCE"].includes(profile.role);
    const names = new Map<string, string>(((items ?? []) as { id: string; name: string }[]).map(item => [item.id, item.name]));
    return priceWarningMessage(rows, names, showPercent);
  } catch {
    return null;
  }
}
