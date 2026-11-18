import { readReportRows } from "@/lib/hpp-reports-server";
import { BATAS_BACA_LAPORAN, petaBerbatas } from "@/lib/konkuren-batas";
import { bacaAnakPerInduk, potongKelompok } from "@/lib/laporan-baca-berkelompok";

type Rel<T> = T | T[] | null;
export type ItemRekap = {
  qty: number; harga: number; jenis: string | null;
  items: Rel<{ tindakan_kategori: string | null; item_type: string | null }>;
  invoices: Rel<{ visits: Rel<{ branch_id: string | null }> }>;
};
type InvoiceRekap = { id: string; visits: Rel<{ branch_id: string | null }> };
type BarisItem = { id: string; invoice_id: string; qty: number; harga: number; jenis: string | null; item_id: string | null };

/**
 * Baris invoice klinik dalam periode untuk Rekap Klinik. Dulu satu query gabungan `invoice_items x invoices x visits x items`
 * per halaman 500 (hitungan pasti + cek akses cabang per baris tiap halaman: ±3 dtk per query, 12+ query berurutan, ±67 dtk).
 * Sekarang invoice (dan kunjungannya) dibaca sekali (halaman bersamaan), item per kelompok 100 id invoice bersamaan, dan
 * kategori tindakan barang per kelompok 100 id. Urutan baris = urutan id item seperti `order("id")` lama (penjumlahan desimal
 * bergantung pada urutan), isi tiap baris sama dengan gabungan lama.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function bacaItemRekapKlinik(supabase: any, mulai: string, akhir: string, saringCabang: string): Promise<{ data: ItemRekap[]; error: null }> {
  const invoices = await readReportRows<InvoiceRekap>(async (awal, ujung) => {
    const query = supabase.from("invoices")
      .select("id, visits!inner(branch_id)", { count: "exact" })
      .is("voided_at", null)
      .gte("created_at", mulai).lte("created_at", akhir);
    const { data, error, count } = await (saringCabang ? query.eq("visits.branch_id", saringCabang) : query)
      .order("id").range(awal, ujung);
    return { data: data as unknown as InvoiceRekap[] | null, error, count };
  }, undefined, { paralel: BATAS_BACA_LAPORAN });
  const perId = new Map(invoices.map(invoice => [invoice.id, invoice] as const));
  const item = await bacaAnakPerInduk<BarisItem>(perId.keys(), async (batch, awal, ujung) => {
    const { data, error, count } = await supabase.from("invoice_items")
      .select("id, invoice_id, qty, harga, jenis, item_id", { count: "exact" }).in("invoice_id", batch).order("id").range(awal, ujung);
    return { data: data as unknown as BarisItem[] | null, error, count };
  });
  const itemIds = [...new Set(item.flatMap(baris => baris.item_id ? [baris.item_id] : []))];
  const master = new Map<string, { tindakan_kategori: string | null; item_type: string | null }>();
  const kelompok = await petaBerbatas(potongKelompok(itemIds), BATAS_BACA_LAPORAN, batch => readReportRows<{ id: string; tindakan_kategori: string | null; item_type: string | null }>(async (awal, ujung) => {
    const { data, error, count } = await supabase.from("items")
      .select("id, tindakan_kategori, item_type", { count: "exact" }).in("id", batch).order("id").range(awal, ujung);
    return { data, error, count };
  }));
  for (const baris of kelompok.flat()) master.set(baris.id, { tindakan_kategori: baris.tindakan_kategori, item_type: baris.item_type });
  return {
    data: item.map(baris => {
      const invoice = perId.get(baris.invoice_id);
      if (!invoice) throw new Error("Invoice sumber baris laporan tidak dapat diverifikasi.");
      return { qty: baris.qty, harga: baris.harga, jenis: baris.jenis, items: baris.item_id ? master.get(baris.item_id) ?? null : null, invoices: { visits: invoice.visits } };
    }),
    error: null,
  };
}
