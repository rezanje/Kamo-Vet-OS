// P04: peringatan (bukan blokir) bila harga beli per satuan dasar menyimpang lebih dari
// 50% dari harga pokok acuan. Tanpa harga pokok acuan sama sekali tidak ada peringatan.
// Baris berharga 0/kosong (bonus) dilewati.
//
// Harga pokok acuan per barang (satuan dasar), urutan pertama yang ada:
//   1. HPP rata-rata bergerak (stock.average_cost) — bila metode persediaan moving average;
//   2. rata-rata tertimbang lapisan FIFO yang masih bersisa: sum(qty_left*unit_cost)/sum(qty_left);
//   3. harga beli terakhir dari faktur pembelian aktif (harga / faktor).
// Production saat ini memakai FIFO, sehingga (2) adalah jalur utama.
//
// Dicek di SERVER saat simpan (server action PO/faktur): HPP tidak pernah dikirim ke browser,
// karena nilai HPP hanya boleh dilihat OWNER/FINANCE. Persentase pun hanya untuk OWNER/FINANCE.
import { readCompleteList } from "./checked-list";

export const PRICE_DEVIATION_LIMIT = 0.5;
/** Nilai field form yang menandakan pengguna sudah membaca peringatan dan tetap menyimpan. */
export const PRICE_CONFIRM_FIELD = "konfirmasi_harga";

type Num = number | string | null | undefined;
export type StockCostRow = { item_id: string; qty: Num; average_cost?: Num };
export type LayerRow = { item_id: string; qty_left: Num; unit_cost: Num };
type Rel<T> = T | T[] | null | undefined;
export type InvoiceLineRow = { id: string; item_id: string | null; harga: Num; faktor: Num;
  purchase_invoices?: Rel<{ tanggal: string | null; created_at?: string | null; voided_at?: string | null }> };
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

/** Rata-rata tertimbang lapisan FIFO bersisa (satuan dasar). Lapisan tanpa harga positif diabaikan. */
export function layerCostMap(rows: LayerRow[]): Map<string, number> {
  const acc = new Map<string, { value: number; qty: number }>();
  for (const row of rows) {
    const qty = finite(row.qty_left), cost = finite(row.unit_cost);
    if (!row.item_id || qty === null || qty <= 0 || cost === null || cost <= 0) continue;
    const a = acc.get(row.item_id) ?? { value: 0, qty: 0 };
    a.value += qty * cost; a.qty += qty;
    acc.set(row.item_id, a);
  }
  return new Map([...acc].map(([id, a]) => [id, a.value / a.qty]));
}

/** Harga beli terakhir per satuan dasar dari baris faktur aktif (tanggal faktur, lalu waktu dibuat, terbaru). */
export function lastPurchaseCostMap(rows: InvoiceLineRow[]): Map<string, number> {
  const best = new Map<string, { key: string; cost: number }>();
  for (const row of rows) {
    const invoice = Array.isArray(row.purchase_invoices) ? row.purchase_invoices[0] : row.purchase_invoices;
    const harga = finite(row.harga), faktor = finite(row.faktor);
    if (!row.item_id || !invoice || invoice.voided_at || harga === null || harga <= 0) continue;
    const cost = harga / (faktor !== null && faktor > 0 ? faktor : 1);
    const key = `${invoice.tanggal ?? ""}|${invoice.created_at ?? ""}|${row.id}`;
    const prior = best.get(row.item_id);
    if (!prior || key > prior.key) best.set(row.item_id, { key, cost });
  }
  return new Map([...best].map(([id, b]) => [id, b.cost]));
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
  const head = showPercent ? "Harga beli per satuan dasar menyimpang lebih dari 50% dari harga pokok acuan (HPP)"
    : "Harga jauh berbeda dari harga pokok rata-rata, periksa ulang";
  return `${head}: ${parts.join(", ")}. Periksa satuan dan harga, lalu centang konfirmasi untuk tetap menyimpan.`;
}

const chunks = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) => ids.slice(i * 100, i * 100 + 100));

/**
 * Harga pokok acuan untuk barang yang diminta saja (lihat urutan di atas), terbatas pada data yang
 * boleh dibaca akun ini (RLS stok/lapisan/faktur). Sumber berikutnya hanya dibaca untuk barang
 * yang belum punya acuan dari sumber sebelumnya.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadReferenceCost(client: any, itemIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(itemIds.filter(Boolean))];
  const out = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const read = async <T extends { id: string }>(table: string, columns: string, label: string, ids: string[], filter: (query: any) => any) => {
    const rows: T[] = [];
    for (const chunk of chunks(ids)) rows.push(...await readCompleteList<T>((from, to) => filter(client.from(table)
      .select(columns, { count: "exact" }).in("item_id", chunk)).order("id").range(from, to), label, { maxRows: null }));
    return rows;
  };
  const missing = () => ids.filter(id => !out.has(id));
  const merge = (map: Map<string, number>) => { for (const [id, cost] of map) if (!out.has(id)) out.set(id, cost); };

  merge(itemHppMap(await read<StockCostRow & { id: string }>("stock", "id,item_id,qty,average_cost", "HPP rata-rata barang", ids,
    query => query.not("average_cost", "is", null))));
  if (missing().length) merge(layerCostMap(await read<LayerRow & { id: string }>("stock_layers", "id,item_id,qty_left,unit_cost", "Lapisan FIFO barang", missing(),
    query => query.gt("qty_left", 0))));
  if (missing().length) merge(lastPurchaseCostMap(await read<InvoiceLineRow>("purchase_invoice_items",
    "id,item_id,harga,faktor,purchase_invoices!inner(tanggal,created_at,voided_at)", "Harga beli terakhir", missing(),
    query => query.gt("harga", 0).is("purchase_invoices.voided_at", null))));
  return out;
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
    const rows = deviatingLines(priced, await loadReferenceCost(client, priced.map(line => line.item_id as string)));
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
