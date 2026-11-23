// Pembantu uji: tiruan fungsi database `laporan_struk_kasir` di atas data tabel fiktif (struk + item), dengan aturan yang sama
// dengan fungsinya: created_at inklusif p_from..p_to, cabang opsional, hanya cabang yang boleh dilihat (boleh = null: semua).
type Baris = Record<string, unknown>;

export function rpcStrukKasirTiruan(tables: { sales: Baris[]; sale_items: Baris[] }, boleh: string[] | null = null) {
  return (args: Record<string, unknown>) => {
    const dari = new Date(String(args.p_from)).getTime();
    const sampai = new Date(String(args.p_to)).getTime();
    const cabang = (args.p_branch_id as string | null) ?? null;
    const sales = tables.sales
      .filter(s => { const t = new Date(String(s.created_at)).getTime(); return t >= dari && t <= sampai; })
      .filter(s => cabang === null || s.branch_id === cabang)
      .filter(s => boleh === null || (typeof s.branch_id === "string" && boleh.includes(s.branch_id)))
      .sort((a, b) => String(a.id) < String(b.id) ? -1 : 1);
    const ids = new Set(sales.map(s => s.id));
    const items = args.p_dengan_item === false ? [] : tables.sale_items.filter(i => ids.has(i.sale_id)).sort((a, b) => String(a.id) < String(b.id) ? -1 : 1);
    return { data: { n_struk: sales.length, n_item: items.length, sales, items }, error: null };
  };
}
