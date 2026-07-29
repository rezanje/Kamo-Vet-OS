// Permintaan barang: validasi baris di server. Klien boleh mengirim apa saja —
// faktor satuan & jenis barang WAJIB ditentukan ulang dari master di sini,
// karena faktor palsu bikin stok bertambah lebih banyak dari yang benar dikirim.

import { loadItemUnits, loadUnitOptions, pickUnit, unitOptions, type ItemUnit } from "./satuan";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type BarisInput = {
  item_id?: string | null;
  qty_diminta?: number;
  satuan?: string;
  catatan?: string | null;
};

export type MasterItem = { nama: string; item_type: string; units: ItemUnit[] };

export type BarisSiap = {
  item_id: string;
  nama: string;
  qty_diminta: number;
  satuan: string;
  faktor: number;
  catatan: string | null;
};

export function parseBarisInput(raw: unknown): BarisInput[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(parsed) ? (parsed as BarisInput[]) : [];
  } catch {
    return [];
  }
}

// Baris tanpa barang / qty 0 diabaikan (baris kosong di form). Barang yang bukan
// Persediaan ditolak terang: jasa & non-persediaan tidak punya stok untuk dikirim.
export function siapkanBaris(
  input: BarisInput[],
  master: Map<string, MasterItem>,
): { rows: BarisSiap[]; error: string | null } {
  const rows: BarisSiap[] = [];
  for (const b of input) {
    const id = String(b?.item_id ?? "");
    const qty = Number(b?.qty_diminta) || 0;
    if (!id || qty <= 0) continue;

    const m = master.get(id);
    if (!m) return { rows: [], error: "Ada barang yang tidak ada di master — pilih ulang dari daftar." };
    if (m.item_type !== "Persediaan") {
      return { rows: [], error: `"${m.nama}" berjenis ${m.item_type} — tidak punya stok, jadi tidak bisa diminta.` };
    }

    const u = pickUnit(m.units, b?.satuan);
    rows.push({
      item_id: id,
      nama: m.nama.slice(0, 160),
      qty_diminta: qty,
      satuan: u.unit,
      faktor: u.factor,
      catatan: (b?.catatan ?? "").toString().trim() || null,
    });
  }
  return { rows, error: rows.length ? null : "Minimal 1 barang dengan jumlah lebih dari 0." };
}

// Katalog untuk form permintaan: hanya barang berstok (Jasa & Non-Persediaan
// tidak muncul sama sekali, biar tidak bisa diminta dari awal).
export type KatalogItem = {
  id: string; code: string; name: string; unit: string;
  kategori: string; stok?: number; units: ItemUnit[];
};

export async function loadKatalogPermintaan(supabase: AnyClient): Promise<KatalogItem[]> {
  const { data: items } = await supabase
    .from("items")
    .select("id, code, name, unit, sell_price, buy_price, item_categories(name)")
    .eq("is_active", true)
    .eq("item_type", "Persediaan")
    .order("name");

  const rows = (items ?? []) as Record<string, unknown>[];
  const extras = await loadItemUnits(supabase, rows.map((i) => String(i.id)));
  return rows.map((i) => {
    const kat = i.item_categories as { name?: string } | { name?: string }[] | null;
    return {
      id: String(i.id),
      code: String(i.code ?? ""),
      name: String(i.name ?? ""),
      unit: String(i.unit ?? "pcs"),
      kategori: (Array.isArray(kat) ? kat[0]?.name : kat?.name) ?? "—",
      units: unitOptions(
        { unit: String(i.unit ?? "pcs"), sell_price: Number(i.sell_price), buy_price: Number(i.buy_price) },
        extras.get(String(i.id)) ?? [],
      ),
    };
  });
}

// Master untuk validasi server action (nama, jenis, satuan resmi).
export async function loadMasterPermintaan(
  supabase: AnyClient,
  ids: string[],
): Promise<Map<string, MasterItem>> {
  const unik = [...new Set(ids.filter(Boolean))];
  if (unik.length === 0) return new Map();
  const [{ data: items }, unitMap] = await Promise.all([
    supabase.from("items").select("id, name, item_type").in("id", unik),
    loadUnitOptions(supabase, unik),
  ]);
  const map = new Map<string, MasterItem>();
  for (const it of (items ?? []) as { id: string; name: string; item_type: string }[]) {
    map.set(it.id, { nama: it.name, item_type: it.item_type, units: unitMap.get(it.id) ?? [] });
  }
  return map;
}
