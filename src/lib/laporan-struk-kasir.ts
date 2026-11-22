import { BATAS_BACA_LAPORAN, petaBerbatas } from "./konkuren-batas";
import { batasTanggalWIB } from "./laporan-transaksi";

/**
 * Struk kasir + baris itemnya dari satu fungsi baca-saja di database (migrasi 20261202200000, hak baca sama dengan RLS).
 * Dulu: `sales` per halaman 500 (+ hitungan pasti tiap halaman) lalu `sale_items` per 100 id struk, semuanya lewat
 * RLS per baris: 1-22 Nov = ±115 query / ±30 dtk database, periode lebih panjang melewati batas 8 dtk per query.
 * Sekarang: satu panggilan per rentang 7 hari (maks. BATAS_BACA_LAPORAN bersamaan), jadi sebulan = 5 panggilan.
 * Jalur lama hanya dipakai bila fungsinya belum ada di database (aplikasi rilis lebih dulu).
 */
export const STRUK_KASIR_RPC = "laporan_struk_kasir";
export const HARI_PER_RENTANG = 7;

type Rel<T> = T | T[] | null;
export type StrukKasirDb = {
  id: string; branch_id: string | null; customer_id: string | null; no_struk: string | null; created_at: string;
  channel: string | null; total: number; merchant_fee_total: number | null; payment_plan: unknown;
  payments_finalized_at: string | null; voided_at: string | null; salesperson_id: string | null; cashier_id: string | null;
  branches: Rel<{ name: string }>; customers: Rel<{ name: string }>;
};
export type ItemKasirDb = {
  id: string; sale_id: string; nama: string; qty: number; harga: number; item_id: string | null;
  satuan: string | null; faktor: number | null;
  item_discount_type: "nominal" | "percent" | null; item_discount_value: number | null; promo_discount: number | null;
  service_performers: unknown;
};
export type HasilStrukKasir = { sales: StrukKasirDb[]; items: ItemKasirDb[] };

type RpcClient = { rpc?: (nama: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> };

const urutId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function tambahHari(tanggal: string, hari: number): string {
  const d = new Date(`${tanggal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + hari);
  return d.toISOString().slice(0, 10);
}

/** Pecah dari..sampai (YYYY-MM-DD, inklusif, WIB) menjadi rentang berurutan tanpa celah/tumpang tindih, masing-masing ≤ `panjang` hari. */
export function rentangHari(dari: string, sampai: string, panjang = HARI_PER_RENTANG): { dari: string; sampai: string }[] {
  const hasil: { dari: string; sampai: string }[] = [];
  for (let awal = dari; awal <= sampai; awal = tambahHari(awal, panjang)) {
    const ujung = tambahHari(awal, panjang - 1);
    hasil.push({ dari: awal, sampai: ujung < sampai ? ujung : sampai });
  }
  return hasil;
}

/** Fungsi belum dipasang di database — HANYA bila galat menyebut fungsi ini (galat lain tidak boleh diam-diam jatuh ke jalur lama). */
export function fungsiStrukBelumAda(error: { code?: string; message?: string }): boolean {
  return (error.code === "PGRST202" || error.code === "42883") && (error.message ?? "").includes(STRUK_KASIR_RPC);
}

async function bacaRentang(supabase: RpcClient, rentang: { dari: string; sampai: string }, cabangId: string, denganItem: boolean): Promise<{ hasil: HasilStrukKasir } | { belumAda: true }> {
  const { mulai, akhir } = batasTanggalWIB(rentang.dari, rentang.sampai);
  const { data, error } = await supabase.rpc!(STRUK_KASIR_RPC, { p_from: mulai, p_to: akhir, p_branch_id: cabangId || null, p_dengan_item: denganItem });
  if (error) {
    if (fungsiStrukBelumAda(error)) return { belumAda: true };
    // Kode galat (57014 = batas waktu, 42501 = izin) tetap terbawa supaya pesan ke pengguna bisa spesifik.
    throw Object.assign(new Error(`Data laporan gagal dibaca: ${error.message}`), { code: error.code });
  }
  const d = data as { n_struk?: unknown; n_item?: unknown; sales?: unknown; items?: unknown } | null;
  if (!d || !Array.isArray(d.sales) || !Array.isArray(d.items) || d.n_struk !== d.sales.length || d.n_item !== d.items.length) {
    throw new Error("Data laporan gagal dibaca: struk atau item tidak lengkap");
  }
  return { hasil: { sales: d.sales as StrukKasirDb[], items: d.items as ItemKasirDb[] } };
}

/**
 * Struk (dan item) kasir pada dari..sampai (tanggal WIB inklusif). null = fungsi belum ada (pemanggil memakai pembaca lama).
 * Setiap struk muncul sekali (diperiksa), setiap item menunjuk struk yang ikut terbaca; hasil urut menurut id.
 */
export async function bacaStrukKasirCepat(supabase: unknown, { dari, sampai, cabangId = "", denganItem = true }: {
  dari: string; sampai: string; cabangId?: string; denganItem?: boolean;
}): Promise<HasilStrukKasir | null> {
  const klien = supabase as RpcClient;
  if (typeof klien.rpc !== "function") return null;
  const rentang = rentangHari(dari, sampai);
  if (!rentang.length) return { sales: [], items: [] };
  // Rentang pertama sendirian: bila fungsi belum ada, berhenti tanpa membanjiri database.
  const pertama = await bacaRentang(klien, rentang[0], cabangId, denganItem);
  if ("belumAda" in pertama) return null;
  const sisa = await petaBerbatas(rentang.slice(1), BATAS_BACA_LAPORAN, async r => {
    const hasil = await bacaRentang(klien, r, cabangId, denganItem);
    if ("belumAda" in hasil) throw new Error(`Data laporan gagal dibaca: fungsi ${STRUK_KASIR_RPC} hilang di tengah pembacaan`);
    return hasil.hasil;
  });
  const semua = [pertama.hasil, ...sisa];
  const sales = semua.flatMap(h => h.sales).sort(urutId);
  const items = semua.flatMap(h => h.items).sort(urutId);
  const idStruk = new Set<string>();
  for (const s of sales) {
    if (typeof s.id !== "string" || !s.id || idStruk.has(s.id)) throw new Error("Data laporan gagal dibaca: identitas struk berubah atau tidak lengkap. Muat ulang laporan.");
    idStruk.add(s.id);
  }
  const idItem = new Set<string>();
  for (const i of items) {
    if (typeof i.id !== "string" || !i.id || idItem.has(i.id)) throw new Error("Data laporan gagal dibaca: identitas item berubah atau tidak lengkap. Muat ulang laporan.");
    idItem.add(i.id);
    if (!idStruk.has(i.sale_id)) throw new Error("Data laporan gagal dibaca: item tanpa struk");
  }
  return { sales, items };
}
