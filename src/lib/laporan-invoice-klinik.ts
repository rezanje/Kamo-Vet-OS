import { BATAS_BACA_LAPORAN, petaBerbatas } from "./konkuren-batas";
import { batasTanggalWIB } from "./laporan-transaksi";
import { fungsiBelumAda, HARI_PER_RENTANG, rentangHari } from "./laporan-struk-kasir";

/**
 * Invoice klinik + baris itemnya (+ kunjungan, snapshot biaya admin DEMO, nama resep racikan, refund) dari satu fungsi baca-saja
 * di database (migrasi 20261203100000, hak baca sama dengan RLS). Dulu: invoice per halaman 500, item/snapshot per 100 id invoice,
 * rekam medis + resep per 100 kunjungan, refund per 100 id — 44 query / ±45 dtk waktu pernyataan untuk 1-22 Nov, semuanya lewat RLS per baris.
 * Sekarang satu panggilan per rentang 7 hari (maks. BATAS_BACA_LAPORAN bersamaan). Jalur lama hanya dipakai bila fungsinya belum ada.
 */
export const INVOICE_KLINIK_RPC = "laporan_invoice_klinik";

type Rel<T> = T | T[] | null;
export type KunjunganDb = {
  branch_id: string | null; customer_id: string | null; doctor_id: string | null;
  branches: Rel<{ name: string }>; customers: Rel<{ name: string }>; pets: Rel<{ name: string }>;
};
export type InvoiceKlinikDb = {
  id: string; visit_id: string; invoice_no: string | null; created_at: string; paid_status: string;
  subtotal: number; discount: number; total: number; salesperson_id: string | null; voided_at: string | null;
  n_item: number; visits: KunjunganDb;
};
export type ItemKlinikDb = {
  id: string; invoice_id: string; deskripsi: string; qty: number; harga: number; diskon_persen: number;
  jenis: string | null; item_id: string | null; compound_recipe_id: string | null;
  bmhp_components: unknown; service_performers: unknown; salesperson_id: string | null;
};
export type DemoDb = { invoice_id: string; fee_amount: number; fee_bearer: string };
export type RacikanDb = { visit_id: string; recipe_name: string };
export type RefundDb = { id: string; invoice_id: string; tanggal: string; clinic_refund_items: { id: string; invoice_item_id: string; qty: number }[] };
export type HasilInvoiceKlinik = { invoices: InvoiceKlinikDb[]; items: ItemKlinikDb[]; demo: DemoDb[]; racikan: RacikanDb[]; refunds: RefundDb[] };

type RpcClient = { rpc?: (nama: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> };

const urutId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

async function bacaRentang(supabase: RpcClient, rentang: { dari: string; sampai: string }, cabangId: string, denganItem: boolean): Promise<{ hasil: HasilInvoiceKlinik } | { belumAda: true }> {
  const { mulai, akhir } = batasTanggalWIB(rentang.dari, rentang.sampai);
  const { data, error } = await supabase.rpc!(INVOICE_KLINIK_RPC, { p_from: mulai, p_to: akhir, p_branch_id: cabangId || null, p_dengan_item: denganItem });
  if (error) {
    if (fungsiBelumAda(error, INVOICE_KLINIK_RPC)) return { belumAda: true };
    // Kode galat (57014 = batas waktu, 42501 = izin) tetap terbawa supaya pesan ke pengguna bisa spesifik.
    throw Object.assign(new Error(`Data laporan gagal dibaca: ${error.message}`), { code: error.code });
  }
  const d = data as { n_invoice?: unknown; n_item?: unknown; invoices?: unknown; items?: unknown; demo?: unknown; racikan?: unknown; refunds?: unknown } | null;
  if (!d || !Array.isArray(d.invoices) || !Array.isArray(d.items) || !Array.isArray(d.demo) || !Array.isArray(d.racikan) || !Array.isArray(d.refunds)
    || d.n_invoice !== d.invoices.length || d.n_item !== d.items.length) {
    throw new Error("Data laporan gagal dibaca: invoice atau item tidak lengkap");
  }
  return { hasil: { invoices: d.invoices as InvoiceKlinikDb[], items: d.items as ItemKlinikDb[], demo: d.demo as DemoDb[], racikan: d.racikan as RacikanDb[], refunds: d.refunds as RefundDb[] } };
}

/**
 * Invoice (dan item, bila `denganItem`) klinik yang tidak dibatalkan pada dari..sampai (tanggal WIB inklusif); cabang = cabang kunjungan.
 * null = fungsi belum ada (pemanggil memakai pembaca lama). Setiap invoice muncul sekali (diperiksa), setiap item menunjuk invoice
 * yang ikut terbaca; hasil urut menurut id (refund juga menurut id; pemanggil yang butuh urutan kelompok lama mengurutkannya sendiri).
 */
export async function bacaInvoiceKlinikCepat(supabase: unknown, { dari, sampai, cabangId = "", denganItem = true }: {
  dari: string; sampai: string; cabangId?: string; denganItem?: boolean;
}): Promise<HasilInvoiceKlinik | null> {
  const klien = supabase as RpcClient;
  if (typeof klien.rpc !== "function") return null;
  const rentang = rentangHari(dari, sampai, HARI_PER_RENTANG);
  if (!rentang.length) return { invoices: [], items: [], demo: [], racikan: [], refunds: [] };
  // Rentang pertama sendirian: bila fungsi belum ada, berhenti tanpa membanjiri database.
  const pertama = await bacaRentang(klien, rentang[0], cabangId, denganItem);
  if ("belumAda" in pertama) return null;
  const sisa = await petaBerbatas(rentang.slice(1), BATAS_BACA_LAPORAN, async r => {
    const hasil = await bacaRentang(klien, r, cabangId, denganItem);
    if ("belumAda" in hasil) throw new Error(`Data laporan gagal dibaca: fungsi ${INVOICE_KLINIK_RPC} hilang di tengah pembacaan`);
    return hasil.hasil;
  });
  const semua = [pertama.hasil, ...sisa];
  const invoices = semua.flatMap(h => h.invoices).sort(urutId);
  const items = semua.flatMap(h => h.items).sort(urutId);
  const idInvoice = new Map<string, number>();
  for (const [indeks, invoice] of invoices.entries()) {
    if (typeof invoice.id !== "string" || !invoice.id || idInvoice.has(invoice.id)) throw new Error("Data laporan gagal dibaca: identitas invoice berubah atau tidak lengkap. Muat ulang laporan.");
    idInvoice.set(invoice.id, indeks);
  }
  const idItem = new Set<string>();
  for (const i of items) {
    if (typeof i.id !== "string" || !i.id || idItem.has(i.id)) throw new Error("Data laporan gagal dibaca: identitas item berubah atau tidak lengkap. Muat ulang laporan.");
    idItem.add(i.id);
    if (!idInvoice.has(i.invoice_id)) throw new Error("Data laporan gagal dibaca: item tanpa invoice");
  }
  const refunds = semua.flatMap(h => h.refunds).filter(r => idInvoice.has(r.invoice_id)).sort(urutId);
  return { invoices, items, demo: semua.flatMap(h => h.demo), racikan: semua.flatMap(h => h.racikan), refunds };
}
