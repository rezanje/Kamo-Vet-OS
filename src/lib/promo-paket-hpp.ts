// Taksiran harga normal & HPP barang hasil untuk editor Promo Paket (hanya BACA).
// Per cabang terpilih (kosong = semua cabang aktif): HPP = biaya lapisan stok tertinggi yang masih tersisa di gudang RETAIL
// aktif cabang itu (gudang klinik/kedaluwarsa/online/transit/nonaktif TIDAK ikut; konservatif, sikap yang sama dengan
// quoteSaleLineCosts di kasir); bila tak ada lapisan, harga beli master; bila keduanya kosong → tidak diketahui (null),
// TIDAK PERNAH dianggap 0. Harga = harga cabang bila ada (item_branch_prices, resolusi yang sama dengan kasir:
// hargaCabang), kalau tidak harga master satuan itu. Cabang dengan angka sama digabung dalam satu baris (branch_ids).
import { readCompleteList } from "./checked-list";
import { hargaCabang } from "./harga-cabang";
import type { PaketItemRef } from "./promo-paket";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;
export type HppItemRow = { id: string; unit: string; sell_price: number | string | null; buy_price: number | string | null };
export type HppUnitRow = { item_id: string; unit: string; factor: number | string; sell_price: number | string | null };
export type HppLayer = { item_id: string; unit_cost: number | string | null };
export type HppRow = { item_id: string; unit: string; price: number; hpp: number | null; source: "lapisan" | "harga_beli" | null; branch_ids?: string[] };
export type HppBranchLayer = HppLayer & { branch_id: string };
export type HppBranchPrice = { branch_id: string; item_id: string; unit: string; sell_price: number | string | null };

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function hitungHppPaket(refs: readonly PaketItemRef[], items: readonly HppItemRow[], units: readonly HppUnitRow[], layers: readonly HppLayer[]): HppRow[] {
  const itemById = new Map(items.map((i) => [i.id, i]));
  return refs.map((r) => {
    const item = itemById.get(r.item_id);
    const unitRow = units.find((u) => u.item_id === r.item_id && u.unit === r.unit);
    const base = !!item && item.unit === r.unit;
    if (!item || (!base && !unitRow)) return { item_id: r.item_id, unit: r.unit, price: 0, hpp: null, source: null };
    const factor = base ? 1 : num(unitRow!.factor);
    const price = Math.round(num(base ? item.sell_price : unitRow!.sell_price));
    const layerCost = Math.max(0, ...layers.filter((l) => l.item_id === r.item_id).map((l) => num(l.unit_cost)));
    const buy = num(item.buy_price);
    const cost = layerCost > 0 ? layerCost : buy > 0 ? buy : 0;
    if (cost <= 0 || factor <= 0) return { item_id: r.item_id, unit: r.unit, price, hpp: null, source: null };
    return { item_id: r.item_id, unit: r.unit, price, hpp: Math.round(cost * factor), source: layerCost > 0 ? "lapisan" : "harga_beli" };
  });
}

const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Satu baris per (barang, satuan, angka harga/HPP berbeda): cabang yang angkanya sama digabung di branch_ids. */
export function hitungHppPaketPerCabang(refs: readonly PaketItemRef[], items: readonly HppItemRow[], units: readonly HppUnitRow[], layers: readonly HppBranchLayer[], prices: readonly HppBranchPrice[], branchIds: readonly string[]): HppRow[] {
  const out: HppRow[] = [];
  for (const ref of refs) {
    const merged: HppRow[] = [];
    for (const branch of branchIds) {
      const map = new Map(prices.filter((p) => p.branch_id === branch).map((p) => [`${p.item_id}|${p.unit}`, num(p.sell_price)] as const));
      const [row] = hitungHppPaket([ref], items, units, layers.filter((l) => l.branch_id === branch));
      const priced: HppRow = row.source === null && row.price === 0 ? row : { ...row, price: Math.round(hargaCabang(map, ref.item_id, ref.unit, row.price)) };
      const same = merged.find((m) => m.price === priced.price && m.hpp === priced.hpp && m.source === priced.source);
      if (same) same.branch_ids!.push(branch); else merged.push({ ...priced, branch_ids: [branch] });
    }
    out.push(...merged);
  }
  return out;
}

/** Membaca (select saja). Melempar bila ada pembacaan yang gagal: pemanggil tidak boleh menganggapnya "tidak ada rugi". */
export async function loadPaketHpp(supabase: AnyClient, refs: readonly PaketItemRef[], branchIds: readonly string[]): Promise<HppRow[]> {
  const ids = [...new Set(refs.map((r) => r.item_id))];
  if (ids.length === 0) return [];
  const branches = await readCompleteList<{ id: string; is_active: boolean }>((from, to) => supabase.from("branches").select("id,is_active", { count: "exact" }).order("id").range(from, to), "Cabang promo", { maxRows: null });
  const chosen = [...new Set(branchIds)];
  if (chosen.length > branches.length) throw new Error("Jumlah cabang terpilih melebihi jumlah cabang yang ada.");
  const scope = branches.filter((b) => b.is_active === true && (chosen.length === 0 || chosen.includes(b.id))).map((b) => b.id);
  const items: HppItemRow[] = [], units: HppUnitRow[] = [], layers: HppBranchLayer[] = [], prices: HppBranchPrice[] = [];
  for (const part of chunks(ids, 100)) {
    items.push(...await readCompleteList<HppItemRow>((from, to) => supabase.from("items").select("id,unit,sell_price,buy_price", { count: "exact" }).in("id", part).order("id").range(from, to), "Barang promo", { maxRows: null }));
    units.push(...await readCompleteList<HppUnitRow & { id: string }>((from, to) => supabase.from("item_units").select("id,item_id,unit,factor,sell_price", { count: "exact" }).in("item_id", part).order("item_id").order("unit").range(from, to), "Satuan barang promo", { maxRows: null }));
  }
  // Gudang yang dipakai kasir petshop = RETAIL aktif (kasir: gudang aktif cabang, urut jenis → RETAIL lebih dulu). Gudang klinik dll. dikecualikan.
  const whBranch = new Map<string, string>();
  for (const part of chunks(scope, 50)) {
    const wh = await readCompleteList<{ id: string; branch_id: string }>((from, to) => supabase.from("warehouses").select("id,branch_id", { count: "exact" }).eq("type", "RETAIL").eq("is_active", true).in("branch_id", part).order("id").range(from, to), "Gudang cabang promo", { maxRows: null });
    for (const w of wh) whBranch.set(w.id, w.branch_id);
  }
  const retailBranches = scope.filter((b) => [...whBranch.values()].includes(b));
  if (retailBranches.length === 0) return hitungHppPaket(refs, items, units, []);
  for (const itemPart of chunks(ids, 100)) {
    for (const whPart of chunks([...whBranch.keys()], 50)) {
      const got = await readCompleteList<HppLayer & { id: string; warehouse_id: string }>((from, to) => supabase.from("stock_layers").select("id,item_id,warehouse_id,unit_cost", { count: "exact" })
        .in("item_id", itemPart).in("warehouse_id", whPart).gt("qty_left", 0).order("id").range(from, to), "Lapisan HPP promo", { maxRows: null });
      for (const l of got) layers.push({ item_id: l.item_id, unit_cost: l.unit_cost, branch_id: whBranch.get(l.warehouse_id)! });
    }
    for (const brPart of chunks(retailBranches, 50)) {
      prices.push(...await readCompleteList<HppBranchPrice & { id: string }>((from, to) => supabase.from("item_branch_prices").select("id,branch_id,item_id,unit,sell_price", { count: "exact" })
        .in("item_id", itemPart).in("branch_id", brPart).order("id").range(from, to), "Harga cabang promo", { maxRows: null }));
    }
  }
  return hitungHppPaketPerCabang(refs, items, units, layers, prices, retailBranches);
}
