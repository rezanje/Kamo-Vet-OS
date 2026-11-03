// "Harga Akhir" promo import: Nilai Diskon = harga jual akhir promo (Rp) untuk SATU
// satuan yang terdaftar. Mesin promo hanya mengenal Persen/Nominal, jadi harga akhir
// diubah menjadi potongan Nominal per satuan = harga normal − harga akhir. Murni (tanpa
// akses database) supaya aturannya bisa dites tuntas.
//
// Potongan per satuan harus rupiah BULAT: mesin kasir (potonganBaris) membulatkan potongan baris ke rupiah,
// jadi selisih berpecahan akan membuat harga di kasir berbeda dari harga akhir. Baris seperti itu ditolak.
//
// Batas yang disengaja: promo tersimpan sebagai potongan nominal. Bila harga normal
// diubah SESUDAH promo disimpan, harga akhir ikut bergeser (tidak terkunci).

export type FinalPriceBranch = { id: string; name: string };
export type FinalPriceMoney = number | string | null | undefined;
export type FinalPriceItem = {
  id: string; unit: string; item_type?: string | null; sell_price?: FinalPriceMoney; buy_price?: FinalPriceMoney;
};
export type FinalPriceUnitRow = { sell_price?: FinalPriceMoney; buy_price?: FinalPriceMoney; /** item_units.factor: base units per this unit (numeric > 0). */ factor?: FinalPriceMoney } | null;
export type FinalPriceBranchPrice = { item_id: string; branch_id: string; unit: string; sell_price: FinalPriceMoney };
export type FinalPriceInput = {
  raw: string;
  unit: string;
  item: FinalPriceItem;
  /** item_units row of the chosen unit; null for the base unit (items.unit). */
  unitRow: FinalPriceUnitRow;
  /** Branches the batch applies to; null/empty = not chosen yet. */
  scope: FinalPriceBranch[] | null;
  branchPrices: FinalPriceBranchPrice[];
  hasQuantityTiers: boolean;
};
export type FinalPriceResult =
  | { ok: true; normalPrice: number; finalPrice: number; potongan: number; percentOff: number; warning?: string }
  | { ok: false; error: string; normalPrice?: number | null };

/**
 * What actually enforces the HPP floor after import (verified in code): kasir petshop (kasir/checkout.ts + cashier_post_stock_atomic)
 * and clinic billing (assert_invoice_price_floor) reject a sale below FIFO HPP; back office /pos/transaksi only shows a warning the user
 * can confirm (finalize_pos_sale has no DB floor) and shows none at all when the FIFO cost cannot be read.
 */
export const COST_FLOOR_SCOPE_NOTE = "Kasir petshop dan klinik menolak penjualan di bawah HPP FIFO; transaksi back office (/pos/transaksi) hanya memberi peringatan yang bisa dikonfirmasi (tanpa peringatan bila HPP FIFO tidak terbaca).";
/** Persediaan whose master cost is unknown (base buy price and, for a derived unit, its own buy price both empty/0): most stock items today. Not an error. */
export const MISSING_COST_WARNING = `HPP master belum terisi; harga akhir belum bisa dicek terhadap modal. ${COST_FLOOR_SCOPE_NOTE}`;
export const INVALID_COST_ERROR = "Harga beli master tidak valid";

export const rupiah = (value: number) => `Rp${value.toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
const AMBIGUOUS = "Tulis angka polos tanpa titik, koma, atau Rp pemisah ribuan (contoh: 18500).";

/** Plain digits, optional dot with 1–2 decimals. Thousand separators / Rp / comma are ambiguous and rejected. */
export function parseFinalPrice(raw: string): { cents: number } | { error: string } {
  const text = String(raw ?? "").trim();
  if (!text) return { error: "Harga akhir wajib diisi" };
  if (/rp/i.test(text) || /[,\s]/.test(text) || /^\d{1,3}(\.\d{3})+(\.\d{1,2})?$/.test(text) || /^\d+\.\d{3,}$/.test(text)) {
    return { error: `Format harga akhir "${text}" ambigu (pemisah ribuan/desimal). ${AMBIGUOUS}` };
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return { error: `Harga akhir harus angka positif tanpa simbol. ${AMBIGUOUS}` };
  const whole = Number(match[1]);
  const cents = whole * 100 + Number((match[2] ?? "").padEnd(2, "0") || 0);
  if (!Number.isSafeInteger(cents)) return { error: "Harga akhir terlalu besar" };
  if (cents <= 0) return { error: "Harga akhir harus lebih dari 0" };
  return { cents };
}

function toCents(value: FinalPriceMoney): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  const cents = Math.round(number * 100);
  return Math.abs(number * 100 - cents) < 1e-6 && Number.isSafeInteger(cents) ? cents : null;
}

function centralPrice(item: FinalPriceItem, unit: string, unitRow: FinalPriceUnitRow): FinalPriceMoney {
  return unit === item.unit ? item.sell_price : unitRow?.sell_price;
}
/** missing = null/undefined/blank/NaN/0; invalid = present but negative, non-numeric, non-finite or more than 2 decimals. */
type MasterCost = { kind: "missing" } | { kind: "invalid" } | { kind: "known"; cents: number };
function parseCost(value: FinalPriceMoney): MasterCost {
  if (value === null || value === undefined) return { kind: "missing" };
  if (typeof value === "number" && Number.isNaN(value)) return { kind: "missing" };
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return { kind: "missing" };
    if (!/^\d+(\.\d+)?$/.test(text)) return { kind: "invalid" };
  }
  const cents = toCents(value);
  if (cents === null) return { kind: "invalid" };
  return cents > 0 ? { kind: "known", cents } : { kind: "missing" };
}
/** Conversion factor of a derived unit (base units per unit); null when absent/non-positive. */
function factorOf(unitRow: FinalPriceUnitRow): number | null {
  const raw = unitRow?.factor;
  if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) return null;
  const factor = Number(raw);
  return Number.isFinite(factor) && factor > 0 ? factor : null;
}
/**
 * Cost per sold unit in cents (fractional allowed), mirroring the cashier floor EXACTLY. The cashier never reads
 * item_units.buy_price: checkout.ts hands only items.buy_price (base) to quoteSaleLineCosts and prices a derived line as
 * qty x factor base units at base cost. So for a derived unit the implied cost is base buy price x factor whenever the base
 * buy price is a known positive value (the unit's own buy price is ignored, not max'ed). Only when the base buy price is
 * missing/0 (or the factor cannot be read) may the unit's own positive buy price serve as a best-effort known cost.
 */
function costOf(item: FinalPriceItem, unit: string, unitRow: FinalPriceUnitRow): { cents: number } | "missing" | "invalid" {
  const derived = unit !== item.unit;
  const base = parseCost(item.buy_price);
  if (base.kind === "invalid") return "invalid";
  if (!derived) return base.kind === "known" ? { cents: base.cents } : "missing";
  // A malformed own buy price is still a data error even though the cashier would ignore it.
  const own = parseCost(unitRow?.buy_price);
  if (own.kind === "invalid") return "invalid";
  const factor = factorOf(unitRow);
  if (base.kind === "known" && factor !== null) return { cents: base.cents * factor };
  return own.kind === "known" ? { cents: own.cents } : "missing";
}

export function convertFinalPrice(input: FinalPriceInput): FinalPriceResult {
  const { item, unit } = input;
  const parsed = parseFinalPrice(input.raw);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  if (!input.scope?.length) return { ok: false, error: "Pilih cabang berlaku (semua cabang atau cabang tertentu) agar harga normal dapat dicek" };

  const central = toCents(centralPrice(item, unit, input.unitRow));
  if (central === null) return { ok: false, error: `Harga normal satuan ${unit} tidak dapat ditentukan (belum terisi atau tidak valid)`, normalPrice: null };
  const perBranch = input.scope.map(branch => {
    const own = input.branchPrices.find(price => price.item_id === item.id && price.branch_id === branch.id && price.unit === unit);
    return { branch, cents: own ? toCents(own.sell_price) : central };
  });
  if (perBranch.some(entry => entry.cents === null)) return { ok: false, error: `Harga normal satuan ${unit} di salah satu cabang tidak valid`, normalPrice: null };
  const distinct = [...new Set(perBranch.map(entry => entry.cents as number))];
  if (distinct.length > 1) {
    const detail = perBranch.map(entry => `${entry.branch.name} ${rupiah((entry.cents as number) / 100)}`).join("; ");
    return { ok: false, error: `Harga normal berbeda antar cabang untuk satuan ${unit} (${detail}). Pisahkan batch per cabang yang harganya sama`, normalPrice: null };
  }
  const normalCents = distinct[0];
  const normalPrice = normalCents / 100;
  if (normalCents <= 0) return { ok: false, error: `Harga normal satuan ${unit} belum diisi (Rp0); harga akhir tidak bisa dihitung`, normalPrice };
  if (input.hasQuantityTiers) return { ok: false, error: "Barang ini punya harga bertingkat per jumlah; harga akhir tidak dapat dijamin. Pakai Nominal atau Persen", normalPrice };

  const finalCents = parsed.cents;
  if (finalCents === normalCents) return { ok: false, error: `Harga akhir sama dengan harga normal (${rupiah(normalPrice)}): tidak ada potongan`, normalPrice };
  if (finalCents > normalCents) return { ok: false, error: `Harga akhir ${rupiah(finalCents / 100)} lebih tinggi dari harga normal ${rupiah(normalPrice)}`, normalPrice };
  // The register rounds the line discount to WHOLE rupiah (potonganBaris in promo-hitung.ts), so a promo can only
  // honour a Harga Akhir whose per-unit discount is a whole number of rupiah. Anything else would charge a different
  // price than typed (normal 10,50 / akhir 10 -> pays 9,50), so it is rejected instead of saved.
  if ((normalCents - finalCents) % 100 !== 0) {
    return { ok: false, error: `Harga akhir ${rupiah(finalCents / 100)} ditolak: selisih harus rupiah bulat. Harga normal ${rupiah(normalPrice)} dikurangi harga akhir ${rupiah(finalCents / 100)} = potongan ${rupiah((normalCents - finalCents) / 100)} per satuan, sedangkan kasir hanya bisa memotong rupiah bulat (kasir akan menagih harga yang berbeda dari harga akhir). Ubah harga akhir agar selisih dengan harga normal rupiah bulat`, normalPrice };
  }

  // Mirror cashier price floor (cashier-price-floor.ts): goods are rejected below a KNOWN cost. The real cost
  // is the FIFO HPP, enforced at sale time by the cashier; at import time the only visible cost is the master
  // buy price of that unit. When that is missing/0 (3326 of 3332 active Persediaan) the row stays valid and
  // carries a warning instead of being rejected.
  if (item.item_type === "Grup") return { ok: false, error: "Harga akhir belum didukung untuk paket (Grup): HPP paket dari komponennya tidak dapat dipastikan saat impor. Pakai Nominal atau Persen", normalPrice };
  // Jasa and Non-Persediaan have no cashier price floor (isPriceFloorGoods = Persediaan / Grup only): no buy price needed.
  if (!item.item_type) return { ok: false, error: "Jenis barang tidak terbaca (kosong); harga akhir tidak dapat diperiksa terhadap HPP", normalPrice };
  if (item.item_type !== "Persediaan" && item.item_type !== "Jasa" && item.item_type !== "Non-Persediaan") return { ok: false, error: `Jenis barang "${item.item_type}" tidak dikenal; harga akhir tidak dapat diperiksa terhadap HPP`, normalPrice };
  let warning: string | undefined;
  if (item.item_type === "Persediaan") {
    const cost = costOf(item, unit, input.unitRow);
    if (cost === "invalid") return { ok: false, error: INVALID_COST_ERROR, normalPrice };
    if (cost === "missing") warning = MISSING_COST_WARNING;
    else if (finalCents < cost.cents - 1e-6) return { ok: false, error: `Harga akhir ${rupiah(finalCents / 100)} di bawah HPP/harga beli master ${rupiah(Math.round(cost.cents) / 100)}`, normalPrice };
  }

  const potonganCents = normalCents - finalCents;
  return {
    ok: true, normalPrice, finalPrice: finalCents / 100, potongan: potonganCents / 100,
    percentOff: Math.round((potonganCents * 10000) / normalCents) / 100,
    ...(warning ? { warning } : {}),
  };
}
