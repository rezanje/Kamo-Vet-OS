// Peran Admin Online (lib/admin-online.ts): bacaan layar impor Shopee lewat RPC khusus, BUKAN tabel langsung.
// Database menolak SELECT tabel apa pun untuk peran ini (pagar baca RLS, migrasi 20261126100100); tiga RPC SECURITY DEFINER
// (admin_online_import_gudang / _catalog / _existing) mengembalikan hanya yang dibutuhkan layar:
// kode/nama/satuan/harga jual barang, stok satu gudang, isi paket, dan status "sudah diimpor" — tanpa harga beli/HPP/margin/pelanggan.
// Fungsi di sini murni (bentuk jawaban -> bentuk yang sama dengan jalur biasa) kecuali dua pembaca di bawah.
import type { createClient } from "@/lib/supabase/server";
import type { GudangOnline } from "@/lib/online-gudang";
import type { ExistingOrders } from "@/lib/shopee-import-match";
import type { ItemUnit } from "@/lib/satuan";
import type { KasirGroupComponent } from "@/lib/kasir-catalog";

type Db = Awaited<ReturnType<typeof createClient>>;

export type BarisBarang = { id: string; code: string; name: string; unit: string | null; sell_price: number | string; item_type: string | null };
export type SumberImporAdminOnline = {
  items: BarisBarang[];
  stock: { item_id: string; qty: number | string }[];
  extraUnits: Map<string, ItemUnit[]>;
  resep: KasirGroupComponent[];
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : v == null ? d : String(v));

/** Jawaban admin_online_import_gudang -> daftar gudang (bentuk GudangOnline). Baris tak lengkap dibuang. */
export function parseGudangAdminOnline(value: unknown): GudangOnline[] {
  return arr(value)
    .map(r => ({ id: str(r.id), name: str(r.name), branch_id: str(r.branch_id), type: str(r.type), branch_name: str(r.branch_name, "—") }))
    .filter(r => r.id && r.branch_id && (r.type === "ONLINE" || r.type === "RETAIL"));
}

/** Jawaban admin_online_import_catalog -> sumber yang sama dengan jalur biasa. Satuan hanya membawa harga jual (buy_price selalu 0). */
export function parseKatalogAdminOnline(value: unknown): SumberImporAdminOnline {
  const v = isObj(value) ? value : {};
  const items = arr(v.items).map((r): BarisBarang => ({
    id: str(r.id), code: str(r.code), name: str(r.name), unit: r.unit == null ? null : str(r.unit),
    sell_price: Number(r.sell_price) || 0, item_type: r.item_type == null ? null : str(r.item_type),
  })).filter(r => r.id);
  const stock = arr(v.stock).map(r => ({ item_id: str(r.item_id), qty: Number(r.qty) || 0 })).filter(r => r.item_id);
  const extraUnits = new Map<string, ItemUnit[]>();
  for (const r of arr(v.units)) {
    const id = str(r.item_id);
    if (!id) continue;
    const list = extraUnits.get(id) ?? [];
    list.push({ unit: str(r.unit), factor: Number(r.factor) || 1, sell_price: Number(r.sell_price) || 0, buy_price: 0 });
    extraUnits.set(id, list);
  }
  const resep = arr(v.group_components).map((r, i): KasirGroupComponent => ({
    id: `${str(r.group_item_id)}:${str(r.component_item_id)}:${i}`, group_item_id: str(r.group_item_id), component_item_id: str(r.component_item_id),
    qty: Number(r.qty) || 0, unit: str(r.unit), factor: Number(r.factor) || 1, sort_order: i,
    component: { id: str(r.component_item_id), code: str(r.code), name: str(r.name), item_type: str(r.item_type, "Persediaan") as never, is_active: r.is_active === true },
  }));
  return { items, stock, extraUnits, resep };
}

/** Jawaban admin_online_import_existing -> ExistingOrders; pesanan aktif didahulukan dari yang sudah dibatalkan (sama dengan jalur biasa). */
export function parseSudahAdaAdminOnline(value: unknown): ExistingOrders {
  const hasil: ExistingOrders = {};
  for (const r of arr(value)) {
    const ref = str(r.external_ref);
    if (!ref) continue;
    const voided = r.voided === true;
    const lama = hasil[ref];
    if (!lama || (lama.voided && !voided)) hasil[ref] = { noStruk: r.no_struk == null ? null : str(r.no_struk), voided };
  }
  return hasil;
}

export async function bacaGudangAdminOnline(db: Db): Promise<{ data: GudangOnline[]; error: unknown }> {
  const { data, error } = await db.rpc("admin_online_import_gudang");
  return { data: error ? [] : parseGudangAdminOnline(data), error };
}

/** Status "sudah diimpor" untuk nomor pesanan yang dikirim (hanya no_struk + void; per 500 nomor). */
export async function bacaSudahAdaAdminOnline(db: Db, orderNos: string[]): Promise<ExistingOrders> {
  const refs = [...new Set(orderNos)];
  const gabung: unknown[] = [];
  for (let i = 0; i < refs.length; i += 500) {
    const r = await db.rpc("admin_online_import_existing", { p_refs: refs.slice(i, i + 500) });
    if (r.error) throw new Error(r.error.message);
    if (Array.isArray(r.data)) gabung.push(...r.data);
  }
  return parseSudahAdaAdminOnline(gabung);
}

export async function bacaSumberAdminOnline(db: Db, warehouseId: string, orderNos: string[]): Promise<SumberImporAdminOnline & { existing: ExistingOrders }> {
  const [kat, existing] = await Promise.all([db.rpc("admin_online_import_catalog", { p_warehouse: warehouseId }), bacaSudahAdaAdminOnline(db, orderNos)]);
  if (kat.error) throw new Error(kat.error.message);
  return { ...parseKatalogAdminOnline(kat.data), existing };
}
