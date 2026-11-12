import type { SupabaseClient } from "@supabase/supabase-js";
import { readCompleteList } from "@/lib/checked-list";
import type { BarangKatalog, BarisLama, KomponenLama, StrukLama } from "@/lib/ubah-struk";

type Client = SupabaseClient;
type Rel<T> = T | T[] | null | undefined;
const one = <T,>(r: Rel<T>): T | null => Array.isArray(r) ? (r[0] ?? null) : (r ?? null);

export type StrukUbah = StrukLama & {
  id: string; revision: number; no_struk: string; branch_id: string; channel: string | null; shift_id: string | null;
  voided_at: string | null; payments_finalized_at: string | null; created_at: string; total: number; merchant_fee_total: number;
  payments: { method: string; amount: number; fee_percent: number; fee_amount: number }[];
  rupiahPerPoin: number | null; customerName: string | null;
};

const ITEM_COLS = "id, item_id, nama, qty, harga, satuan, faktor, target_species, service_performers, item_discount_type, item_discount_value, promo_id, promo_discount, quantity_pool_claim, promo_claim_id, promo_sets, promo_syarat_units, promo_hasil_units, promo_floor_waiver, source_position";

/** Struk lama dibaca dari database (sumber kebenaran untuk promo/pelaksana/komponen yang dibawa). */
export async function loadStrukUbah(supabase: Client, saleId: string): Promise<StrukUbah | null> {
  const { data, error } = await supabase.from("sales")
    .select(`id, revision, no_struk, branch_id, channel, shift_id, voided_at, payments_finalized_at, created_at, customer_id, poin_digunakan, subtotal, discount, diskon_kategori, total, merchant_fee_total,
      customers(name, customer_categories(rupiah_per_poin, is_active)),
      sale_payments(method, amount, fee_percent, fee_amount),
      sale_items(${ITEM_COLS}, sale_item_group_components(component_item_id, component_code, component_name, item_type, qty_per_group, unit, factor, total_base_qty, sort_order))`)
    .eq("id", saleId).maybeSingle();
  if (error) throw new Error("Struk belum dapat dibaca. Muat ulang halaman.");
  if (!data) return null;
  const row = data as Record<string, unknown> & {
    customers: Rel<{ name: string; customer_categories: Rel<{ rupiah_per_poin: number; is_active: boolean }> }>;
    sale_payments: { method: string; amount: number; fee_percent: number; fee_amount: number }[] | null;
    sale_items: (BarisLama & { sale_item_group_components: KomponenLama[] | null })[] | null;
  };
  const cust = one(row.customers);
  const kat = one(cust?.customer_categories);
  const items = (row.sale_items ?? [])
    .map(({ sale_item_group_components, ...line }) => ({
      ...line, qty: Number(line.qty), harga: Number(line.harga), faktor: Number(line.faktor) || 1,
      item_discount_value: Number(line.item_discount_value) || 0, promo_discount: Number(line.promo_discount) || 0,
      promo_syarat_units: Number(line.promo_syarat_units) || 0, promo_hasil_units: Number(line.promo_hasil_units) || 0,
      components: (sale_item_group_components ?? []).map(c => ({ ...c, qty_per_group: Number(c.qty_per_group), factor: Number(c.factor), total_base_qty: Number(c.total_base_qty), sort_order: Number(c.sort_order) || 0 }))
        .sort((a, b) => a.sort_order - b.sort_order),
    }))
    .sort((a, b) => (a.source_position ?? 1e9) - (b.source_position ?? 1e9) || a.id.localeCompare(b.id));
  return {
    id: String(row.id), revision: Number(row.revision), no_struk: String(row.no_struk), branch_id: String(row.branch_id),
    channel: (row.channel as string | null) ?? null, shift_id: (row.shift_id as string | null) ?? null,
    voided_at: (row.voided_at as string | null) ?? null, payments_finalized_at: (row.payments_finalized_at as string | null) ?? null,
    created_at: String(row.created_at), customer_id: (row.customer_id as string | null) ?? null,
    poin_digunakan: Number(row.poin_digunakan) || 0, subtotal: Number(row.subtotal), discount: Number(row.discount),
    diskon_kategori: Number(row.diskon_kategori) || 0, total: Number(row.total), merchant_fee_total: Number(row.merchant_fee_total) || 0,
    payments: (row.sale_payments ?? []).map(p => ({ method: p.method, amount: Number(p.amount), fee_percent: Number(p.fee_percent) || 0, fee_amount: Number(p.fee_amount) || 0 })),
    rupiahPerPoin: kat?.is_active ? Number(kat.rupiah_per_poin) : null, customerName: cust?.name ?? null,
    items,
  };
}

type ItemRow = { id: string; code: string | null; name: string; unit: string | null; item_type: string; is_active: boolean; sell_price: number | null; item_units: { unit: string; factor: number; sell_price: number | null }[] | null };

export type BarangPilihan = BarangKatalog & { code: string; harga: number; unitHarga: Record<string, number> };

function keKatalog(row: ItemRow): BarangPilihan {
  const base = row.unit || "pcs";
  const units = [{ unit: base, factor: 1 }, ...(row.item_units ?? []).filter(u => u.unit !== base).map(u => ({ unit: u.unit, factor: Number(u.factor) }))];
  const unitHarga: Record<string, number> = { [base]: Number(row.sell_price) || 0 };
  for (const u of row.item_units ?? []) if (u.unit !== base) unitHarga[u.unit] = Number(u.sell_price) || 0;
  return { id: row.id, code: row.code ?? "", nama: row.name, item_type: row.item_type, is_active: row.is_active, units, harga: Number(row.sell_price) || 0, unitHarga };
}

const COLS = "id, code, name, unit, item_type, is_active, sell_price, item_units(unit, factor, sell_price)";

/** Barang tertentu (untuk aksi simpan). */
export async function loadKatalogUntuk(supabase: Client, ids: string[]): Promise<Map<string, BarangPilihan>> {
  const unik = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, BarangPilihan>();
  for (let i = 0; i < unik.length; i += 200) {
    const { data, error } = await supabase.from("items").select(COLS).in("id", unik.slice(i, i + 200));
    if (error) throw new Error("Data barang belum dapat dibaca. Coba lagi.");
    for (const row of (data ?? []) as unknown as ItemRow[]) map.set(row.id, keKatalog(row));
  }
  return map;
}

/** Semua barang aktif yang boleh ditambahkan (bukan Grup) untuk pencarian di formulir. */
export async function loadKatalogPilihan(supabase: Client): Promise<BarangPilihan[]> {
  const rows = await readCompleteList<ItemRow>((from, to) => supabase.from("items").select(COLS, { count: "exact" })
    .eq("is_active", true).neq("item_type", "Grup").order("name").order("id").range(from, to), "Daftar barang", { maxRows: null });
  return rows.map(keKatalog);
}
