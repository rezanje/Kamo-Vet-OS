"use server";

import { createClient } from "@/lib/supabase/server";
import { loadHargaCabang, hargaCabang, applyHargaCabang } from "@/lib/harga-cabang";
import { loadUnitOptions, resolveSubmittedUnit } from "@/lib/satuan";
import { loadPromoAktif } from "@/lib/promo-hitung";
import { serviceLinePromos } from "@/lib/service-line-promos";
import { composeHppSafe, composeSyaratHasilCart, loadSyaratHasilKasir } from "@/lib/promo-syarat-hasil-checkout";
import { quoteSaleLineCosts } from "@/lib/sale-fifo-quote";

export type PromoGuardResult = {
  /** syarat_hasil promos whose reward would sell below FIFO cost without an Owner waiver (the server drops them at checkout). */
  excluded: { promo_id: string; name: string | null; reason: "below_hpp" }[];
  notes: string[];
  /** Promos kept ONLY thanks to the Owner waiver: the receipt must then carry no voucher/points/total discount. */
  waiverPromoIds: string[];
};
export type PromoGuardInput = {
  cart: { item_id: string; satuan?: string; qty: number; harga?: number; item_discount_type?: "nominal" | "percent" | null; item_discount_value?: number | null }[];
  pick: string;
};
/** Cart cap for the advisory action (a cashier cart is far below this). */
const MAX_GUARD_LINES = 200;
const NONE: PromoGuardResult = { excluded: [], notes: [], waiverPromoIds: [] };

/**
 * ADVISORY check for the cashier screen (KasirClient): the screen has no FIFO cost, so it asks the server which syarat-hasil promos the
 * below-HPP guard would drop for this cart. Prices/factors/types come from the masters; only item, unit, qty and a LOWER-than-official price
 * (tier / negotiated: such a line is not promo evidence) are taken from the client. checkoutKasir recomputes everything and stays the authority.
 */
export async function quotePromoGuard(input: PromoGuardInput): Promise<PromoGuardResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sesi berakhir. Masuk ulang.");
  // Server action yang bisa dipanggil klien: batasi ukuran keranjang sebelum membaca apa pun (kasir normal jauh di bawah ini).
  if (Array.isArray(input.cart) && input.cart.length > MAX_GUARD_LINES) throw new Error(`Keranjang terlalu besar untuk dicek (maksimal ${MAX_GUARD_LINES} baris).`);
  const { data: shift } = await supabase.from("cashier_shifts").select("id, branch_id")
    .eq("opened_by", user.id).eq("status", "open").eq("shift_type", "petshop").maybeSingle();
  if (!shift) throw new Error("Buka shift kasir dulu.");
  const branchId = shift.branch_id as string;

  const sh = await loadSyaratHasilKasir(supabase, branchId);
  if (!sh.released || sh.defs.length === 0) return NONE;

  const lines = (Array.isArray(input.cart) ? input.cart : []).filter((l) => l && l.item_id && Number(l.qty) > 0);
  const ids = [...new Set(lines.map((l) => l.item_id))];
  if (ids.length === 0) return NONE;
  const [{ data: itemsHarga }, hargaMap, unitMap] = await Promise.all([
    supabase.from("items").select("id, nama:name, unit, item_type, sell_price, buy_price, min_sell_qty, is_active").in("id", ids),
    loadHargaCabang(supabase, branchId, ids),
    loadUnitOptions(supabase, ids),
  ]);
  type Master = { id: string; nama: string; unit: string; item_type: string; sell_price: number; buy_price: number; min_sell_qty: number; is_active: boolean };
  const master = new Map(((itemsHarga ?? []) as Master[]).map((i) => [i.id, i]));
  const buyPrices = new Map([...master.values()].map((i) => [i.id, Number(i.buy_price)] as const));
  const rows = lines.flatMap((l) => {
    const p = master.get(l.item_id);
    if (!p?.is_active) return [];
    const opsi = applyHargaCabang(unitMap.get(l.item_id) ?? [], l.item_id, hargaMap);
    let satuan = p.unit, faktor = 1, official = hargaCabang(hargaMap, l.item_id, p.unit, Number(p.sell_price));
    if (opsi.length > 0) { const u = resolveSubmittedUnit(opsi, l.satuan); satuan = u.unit; faktor = u.factor; official = u.sell_price; }
    const asked = Number(l.harga);
    return [{
      item_id: l.item_id, nama: p.nama, qty: Number(l.qty), satuan, faktor, item_type: p.item_type,
      harga: Number.isFinite(asked) && asked >= 0 && asked < official ? asked : official, officialPrice: official,
      item_discount_type: l.item_discount_type ?? null, item_discount_value: Math.max(0, Number(l.item_discount_value) || 0),
      minSellBase: Number(p.min_sell_qty) || 0,
    }];
  });
  const promoAktif = await loadPromoAktif(supabase, branchId, []);
  const legacy = (list: typeof rows, only?: string) => serviceLinePromos(only === undefined ? promoAktif : promoAktif.filter((p) => p.id === only),
    list.map((row) => ({ ...row, officialPrice: row.harga, manualOverride: Number(row.item_discount_value) > 0 })));
  const submitted = String(input.pick ?? "").trim();
  const mode = submitted === "none" ? "tanpa" : submitted === "" || submitted === "auto" ? "auto" : "pilih";
  const compose = (excludedIds: string[]) => composeSyaratHasilCart({
    rows, defs: sh.defs, legacy: (list, only) => legacy(list as unknown as typeof rows, only), mode, pickId: mode === "pilih" ? submitted : null, excludedIds,
  });
  if (compose([]).strategy !== "syarat_hasil") return NONE; // nothing claimed: nothing for the HPP guard to do (no stock-layer reads)
  const { data: wh } = await supabase.from("warehouses").select("id").eq("branch_id", branchId).eq("is_active", true).order("type").limit(1).maybeSingle();
  if (!wh) return NONE;
  const safe = await composeHppSafe({ compose, quoteCosts: (list) => quoteSaleLineCosts(supabase, wh.id as string, list, buyPrices) });
  return { excluded: safe.excluded, notes: safe.notes, waiverPromoIds: safe.waiverNeeded.map((w) => w.promo_id) };
}
