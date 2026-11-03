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
export type FinalPriceUnitRow = { sell_price?: FinalPriceMoney; buy_price?: FinalPriceMoney } | null;
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
  | { ok: true; normalPrice: number; finalPrice: number; potongan: number; percentOff: number }
  | { ok: false; error: string; normalPrice?: number | null };

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
function costOf(item: FinalPriceItem, unit: string, unitRow: FinalPriceUnitRow): FinalPriceMoney {
  return unit === item.unit ? item.buy_price : unitRow?.buy_price;
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

  // Mirror cashier price floor (cashier-price-floor.ts): goods are rejected below HPP, never allowed with
  // unknown cost. Here the only cost visible at import time is the master buy price of that unit; the
  // cashier still checks the real FIFO HPP at sale time.
  if (item.item_type === "Grup") return { ok: false, error: "Harga akhir belum didukung untuk paket (Grup): HPP paket dari komponennya tidak dapat dipastikan saat impor. Pakai Nominal atau Persen", normalPrice };
  // Jasa and Non-Persediaan have no cashier price floor (isPriceFloorGoods = Persediaan / Grup only): no buy price needed.
  if (!item.item_type) return { ok: false, error: "Jenis barang tidak terbaca (kosong); harga akhir tidak dapat diperiksa terhadap HPP", normalPrice };
  if (item.item_type !== "Persediaan" && item.item_type !== "Jasa" && item.item_type !== "Non-Persediaan") return { ok: false, error: `Jenis barang "${item.item_type}" tidak dikenal; harga akhir tidak dapat diperiksa terhadap HPP`, normalPrice };
  if (item.item_type === "Persediaan") {
    const cost = toCents(costOf(item, unit, input.unitRow));
    if (cost === null || cost <= 0) return { ok: false, error: `HPP/harga beli satuan ${unit} belum terisi; harga akhir tidak dapat diperiksa terhadap HPP`, normalPrice };
    if (finalCents < cost) return { ok: false, error: `Harga akhir ${rupiah(finalCents / 100)} di bawah HPP/harga beli master ${rupiah(cost / 100)}`, normalPrice };
  }

  const potonganCents = normalCents - finalCents;
  return {
    ok: true, normalPrice, finalPrice: finalCents / 100, potongan: potonganCents / 100,
    percentOff: Math.round((potonganCents * 10000) / normalCents) / 100,
  };
}
