// Pembantu uji: tiruan fungsi database `laporan_invoice_klinik` di atas data tabel fiktif, dengan aturan yang sama dengan fungsinya:
// created_at inklusif p_from..p_to, invoice dibatalkan dibuang, cabang opsional pada kunjungan, hanya cabang yang boleh dilihat
// (boleh = null: semua), item/snapshot/refund hanya milik invoice yang terlihat, resep racikan hanya untuk kunjungan yang punya
// baris tanpa tautan racikan/barang (bukan jasa). Invoice membawa `n_item` dan `visits` seperti hasil fungsi aslinya.
type Baris = Record<string, unknown>;
export type TabelInvoiceKlinik = {
  invoices: Baris[]; invoice_items: Baris[]; clinic_demo_invoice_snapshots?: Baris[];
  medical_records?: Baris[]; compounding_recipes?: Baris[]; clinic_refunds?: Baris[];
};
const urut = (a: Baris, b: Baris) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;

export function rpcInvoiceKlinikTiruan(tables: TabelInvoiceKlinik, boleh: string[] | null = null) {
  return (args: Record<string, unknown>) => {
    const dari = new Date(String(args.p_from)).getTime();
    const sampai = new Date(String(args.p_to)).getTime();
    const cabang = (args.p_branch_id as string | null) ?? null;
    const denganItem = args.p_dengan_item !== false;
    const cabangKunjungan = (i: Baris) => (i.visits as { branch_id: string | null }).branch_id;
    const invoices = tables.invoices
      .filter(i => { const t = new Date(String(i.created_at)).getTime(); return t >= dari && t <= sampai; })
      .filter(i => (i.voided_at ?? null) === null)
      .filter(i => cabang === null || cabangKunjungan(i) === cabang)
      .filter(i => boleh === null || (typeof cabangKunjungan(i) === "string" && boleh.includes(cabangKunjungan(i) as string)))
      .sort(urut);
    const ids = new Set(invoices.map(i => i.id));
    const semuaItem = tables.invoice_items.filter(i => ids.has(i.invoice_id)).sort(urut);
    const jumlah = new Map<unknown, number>();
    for (const i of semuaItem) jumlah.set(i.invoice_id, (jumlah.get(i.invoice_id) ?? 0) + 1);
    const items = denganItem ? semuaItem : [];
    const kunjunganRacikan = new Set(denganItem
      ? semuaItem.filter(i => !i.compound_recipe_id && i.jenis !== "jasa" && !i.item_id).map(i => invoices.find(v => v.id === i.invoice_id)?.visit_id)
      : []);
    const records = new Map((tables.medical_records ?? []).filter(m => kunjunganRacikan.has(m.visit_id)).map(m => [m.id, m.visit_id] as const));
    const racikan = denganItem ? (tables.compounding_recipes ?? []).filter(r => records.has(r.medical_record_id))
      .map(r => ({ visit_id: records.get(r.medical_record_id), recipe_name: r.recipe_name, id: r.id }))
      .sort((a, b) => String(a.visit_id) < String(b.visit_id) ? -1 : String(a.visit_id) > String(b.visit_id) ? 1 : urut(a, b))
      .map(({ visit_id, recipe_name }) => ({ visit_id, recipe_name })) : [];
    const demo = denganItem ? (tables.clinic_demo_invoice_snapshots ?? []).filter(d => ids.has(d.invoice_id))
      .sort((a, b) => String(a.invoice_id) < String(b.invoice_id) ? -1 : 1) : [];
    const refunds = denganItem ? (tables.clinic_refunds ?? []).filter(r => ids.has(r.invoice_id)).sort(urut) : [];
    return {
      data: {
        n_invoice: invoices.length, n_item: items.length,
        invoices: invoices.map(i => ({ ...i, n_item: jumlah.get(i.id) ?? 0 })),
        items, demo, racikan, refunds,
      },
      error: null,
    };
  };
}
