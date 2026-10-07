// Satuan berjenjang — satu sumber aturan konversi untuk POS, pembelian & klinik.
// Satuan dasar = items.unit (faktor 1); turunan datang dari tabel item_units.
// Stok SELALU disimpan dalam satuan dasar: qty_stok = qty × faktor.

export type ItemUnit = { unit: string; factor: number; sell_price: number; buy_price: number };

export type BaseItem = { unit: string | null; sell_price: number; buy_price?: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

// Daftar satuan yang boleh dipilih: dasar dulu, lalu turunan dari kecil ke besar.
export function unitOptions(base: BaseItem, extra: ItemUnit[] = []): ItemUnit[] {
  const dasar: ItemUnit = {
    unit: (base.unit ?? "pcs") || "pcs",
    factor: 1,
    sell_price: Number(base.sell_price) || 0,
    buy_price: Number(base.buy_price) || 0,
  };
  const turunan = extra
    .filter((u) => u.unit && u.unit !== dasar.unit && Number(u.factor) > 0)
    .map((u) => ({
      unit: u.unit,
      factor: Number(u.factor),
      sell_price: Number(u.sell_price) || 0,
      buy_price: Number(u.buy_price) || 0,
    }))
    .sort((a, b) => a.factor - b.factor);
  return [dasar, ...turunan];
}

// Satuan yang dipilih di form bisa saja sudah dihapus dari master → jangan
// mengarang faktor 1 diam-diam (stok bakal salah potong); pakai satuan dasar.
export function pickUnit(options: ItemUnit[], unit: string | null | undefined): ItemUnit {
  return options.find((o) => o.unit === unit) ?? options[0];
}

// Submitted document units must never fall back from a removed box to pcs.
// Empty legacy payloads may default to base; UI previews keep using pickUnit.
export function resolveSubmittedUnit(options: ItemUnit[], unit: string | null | undefined): ItemUnit {
  const chosen = unit == null || unit === "" ? options[0] : options.find(option => option.unit === unit);
  if (!chosen || !Number.isFinite(chosen.factor) || chosen.factor <= 0) {
    throw new Error("Satuan barang tidak tersedia atau berubah. Pilih barang dan satuannya lagi.");
  }
  return chosen;
}

// qty dalam satuan pilihan → qty dalam satuan dasar (untuk stockIn/stockOut).
export function toBaseQty(qty: number, faktor: number): number {
  const f = Number(faktor) > 0 ? Number(faktor) : 1;
  return (Number(qty) || 0) * f;
}

// Harga per satuan pilihan → cost per satuan dasar (layer FIFO selalu per satuan dasar).
export function toBaseCost(harga: number, faktor: number): number {
  const f = Number(faktor) > 0 ? Number(faktor) : 1;
  return (Number(harga) || 0) / f;
}

export function labelSatuan(qty: number, unit: string | null | undefined): string {
  return `${Number(qty) || 0} ${unit || "pcs"}`;
}

// Ambil turunan untuk sekumpulan item sekaligus (hindari N+1 di halaman katalog).
export async function loadItemUnits(
  supabase: AnyClient,
  itemIds?: string[],
): Promise<Map<string, ItemUnit[]>> {
  const ids = itemIds ? [...new Set(itemIds.filter(Boolean))] : undefined;
  if (ids?.length === 0) return new Map();
  const chunks = ids ? Array.from({ length: Math.ceil(ids.length / 200) }, (_, index) => ids.slice(index * 200, (index + 1) * 200)) : [undefined];
  const pages = await Promise.all(chunks.map(async chunk => {
    const rows: (ItemUnit & { item_id: string })[] = [];
    for (let from = 0; ; from += 1000) {
      let query = supabase.from("item_units").select("item_id, unit, factor, sell_price, buy_price")
        .order("factor").order("item_id").order("unit");
      if (chunk) query = query.in("item_id", chunk);
      const { data, error } = await query.range(from, from + 999);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as (ItemUnit & { item_id: string })[];
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return rows;
  }));
  const data = pages.flat();
  const map = new Map<string, ItemUnit[]>();
  for (const r of (data ?? []) as (ItemUnit & { item_id: string })[]) {
    const list = map.get(r.item_id) ?? [];
    list.push({ unit: r.unit, factor: Number(r.factor), sell_price: Number(r.sell_price), buy_price: Number(r.buy_price) });
    map.set(r.item_id, list);
  }
  return map;
}

// Satuan dasar + turunan per item, siap dipakai pickUnit(). Server action WAJIB
// pakai ini untuk menentukan faktor: faktor yang dikirim klien tidak boleh dipercaya
// (faktor palsu = stok terpotong lebih sedikit dari barang yang benar-benar keluar).
export async function loadUnitOptions(
  supabase: AnyClient,
  itemIds: string[],
  options: { includeInactive?: boolean } = {},
): Promise<Map<string, ItemUnit[]>> {
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const [itemPages, extras] = await Promise.all([
    Promise.all(Array.from({ length: Math.ceil(ids.length / 200) }, async (_, index) => {
      const chunk = ids.slice(index * 200, (index + 1) * 200);
      let query = supabase.from("items").select("id, unit, sell_price, buy_price")
        .in("id", chunk).order("id");
      // Returning a source-verified historical SKU may legitimately use an inactive master.
      if (!options.includeInactive) query = query.eq("is_active", true);
      const { data, error } = await query.range(0, 999);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; unit: string; sell_price: number; buy_price: number }[];
    })),
    loadItemUnits(supabase, ids),
  ]);
  const items = itemPages.flat();
  const found = new Set(items.map(item => item.id));
  if (ids.some(id => !found.has(id))) throw new Error("Ada barang yang tidak aktif atau tidak ditemukan. Pilih lagi dari master.");
  const map = new Map<string, ItemUnit[]>();
  for (const it of (items ?? []) as { id: string; unit: string; sell_price: number; buy_price: number }[]) {
    map.set(it.id, unitOptions(it, extras.get(it.id) ?? []));
  }
  return map;
}

// Parsing baris satuan dari form master SKU. Dipakai server action → jangan percaya
// nilai klien: faktor ≤ 0 atau duplikat satuan bikin konversi stok tidak deterministik.
export type UnitDraft = { unit: string; factor: number; sell_price: number; buy_price: number };

export function parseUnitDrafts(raw: unknown, baseUnit: string): { rows: UnitDraft[]; error: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw ?? "[]"));
  } catch {
    return { rows: [], error: null };
  }
  if (!Array.isArray(parsed)) return { rows: [], error: null };

  const rows: UnitDraft[] = [];
  const seen = new Set([baseUnit.trim().toLowerCase()]);
  for (const r of parsed) {
    const row = r as Partial<UnitDraft>;
    const unit = String(row?.unit ?? "").trim().slice(0, 20);
    if (!unit) continue;
    const factor = Number(row?.factor);
    if (!Number.isFinite(factor) || factor <= 0) {
      return { rows: [], error: `Isi satuan "${unit}" harus lebih dari 0` };
    }
    const key = unit.toLowerCase();
    if (seen.has(key)) {
      return { rows: [], error: `Satuan "${unit}" dobel — tiap satuan hanya boleh sekali` };
    }
    seen.add(key);
    const sell = Number(row?.sell_price);
    const buy = Number(row?.buy_price);
    rows.push({
      unit,
      factor,
      sell_price: Number.isFinite(sell) && sell > 0 ? sell : 0,
      buy_price: Number.isFinite(buy) && buy > 0 ? buy : 0,
    });
  }
  return { rows, error: null };
}
