import { describe, expect, it } from "vitest";
import { convertFinalPrice, type FinalPriceInput } from "../promo-final-price";
import { hitungPromoKeranjang, potonganBaris, type BarisKeranjang, type PromoHitung } from "../promo-hitung";

// These tests feed what the Harga Akhir validator ACCEPTS into the REAL register promo engine
// (promo-hitung.ts) and check the money the register charges per unit equals the typed Harga Akhir.

const SCOPE = [{ id: "branch-a", name: "Cabang A" }];
const ITEM = (sell: number | string, buy: number | string = 0.01) =>
  ({ id: "item-1", unit: "PCS", item_type: "Persediaan", sell_price: sell, buy_price: buy });
const input = (raw: string, over: Partial<FinalPriceInput> = {}): FinalPriceInput => ({
  raw, unit: "PCS", item: ITEM(20000), unitRow: null, scope: SCOPE, branchPrices: [], hasQuantityTiers: false, ...over,
});

// The promo exactly as the RPC stores it from an accepted row: nominal per unit, restricted to one unit.
const promoFrom = (potongan: number, unit: string, extra: Partial<PromoHitung> = {}): PromoHitung => ({
  id: "promo-" + unit, name: "Promo " + unit, itemIds: ["item-1"], unit, minQty: null, maxQty: null, kelipatan: false,
  autoApply: true, discountType: "nominal", discountValue: potongan, ...extra,
});
const line = (harga: number, qty: number, satuan: string, faktor = 1, itemId = "item-1"): BarisKeranjang =>
  ({ item_id: itemId, qty, harga, satuan, faktor });

/** Integer cents the register charges for one line after the promo engine. */
const paidCents = (harga: number, qty: number, potongan: number) => Math.round(harga * qty * 100) - Math.round(potongan * 100);

describe("Harga Akhir accepted by the validator -> register price equals Harga Akhir (real promo engine)", () => {
  it("base unit, whole rupiah: qty 1 and 3", () => {
    const result = convertFinalPrice(input("18500"));
    if (!result.ok) throw new Error(result.error);
    const promo = promoFrom(result.potongan, "PCS");
    for (const qty of [1, 3]) {
      const potongan = potonganBaris(line(result.normalPrice, qty, "PCS"), promo);
      expect(paidCents(result.normalPrice, qty, potongan)).toBe(1850000 * qty);
    }
  });

  it("fractional normal price with a whole-rupiah discount: normal 10.50, final 9.50 -> potongan 1, pays 9.50", () => {
    const result = convertFinalPrice(input("9.50", { item: ITEM("10.50") }));
    if (!result.ok) throw new Error(result.error);
    expect(result).toMatchObject({ normalPrice: 10.5, finalPrice: 9.5, potongan: 1 });
    const promo = promoFrom(result.potongan, "PCS");
    for (const qty of [1, 3]) {
      expect(paidCents(10.5, qty, potonganBaris(line(10.5, qty, "PCS"), promo))).toBe(950 * qty);
    }
  });

  it("derived unit (factor 12, its own item_units price): qty 1 and 3", () => {
    const result = convertFinalPrice(input("215000", { unit: "DUS", unitRow: { sell_price: 240000, buy_price: 150000 } }));
    if (!result.ok) throw new Error(result.error);
    expect(result.potongan).toBe(25000);
    const promo = promoFrom(result.potongan, "DUS");
    for (const qty of [1, 3]) {
      expect(paidCents(240000, qty, potonganBaris(line(240000, qty, "DUS", 12), promo))).toBe(21500000 * qty);
    }
  });

  it("derived unit with fractional normal price and whole discount", () => {
    const result = convertFinalPrice(input("239999.25", { unit: "DUS", unitRow: { sell_price: "240000.25", buy_price: 150000 } }));
    expect(result.ok).toBe(true);
    const bad = convertFinalPrice(input("239999.75", { unit: "DUS", unitRow: { sell_price: "240000.25", buy_price: 150000 } }));
    expect(bad.ok).toBe(false);
  });

  it("mixed cart: base line, derived line, an unrelated line and a different SKU, via hitungPromoKeranjang", () => {
    const base = convertFinalPrice(input("9.50", { item: ITEM("10.50") }));
    const derived = convertFinalPrice(input("215000", { unit: "DUS", unitRow: { sell_price: 240000, buy_price: 150000 } }));
    if (!base.ok || !derived.ok) throw new Error("expected accepted rows");
    const promos = [promoFrom(base.potongan, "PCS"), promoFrom(derived.potongan, "DUS")];
    const cart = [line(10.5, 3, "PCS"), line(240000, 1, "DUS", 12), line(240000, 3, "DUS", 12), line(5000, 2, "PCS", 1, "other")];
    const result = hitungPromoKeranjang(promos, cart);
    const pcs = result.find(r => r.promoName === "Promo PCS")!;
    expect(paidCents(10.5, 3, pcs.potongan)).toBe(950 * 3);
    // two DUS lines are separate cart lines: each is discounted per unit
    expect(result.filter(r => r.promoName === "Promo DUS").map(r => r.potongan)).toEqual([25000, 75000]);
    expect(result.some(r => r.item_id === "other")).toBe(false); // unrelated SKU untouched
    expect(result.find(r => r.promoName === "Promo PCS")!.potongan).toBe(3);
  });

  it("documented limit: the single LARGEST promo per line wins, so a bigger promo can end below Harga Akhir", () => {
    const accepted = convertFinalPrice(input("18500"));
    if (!accepted.ok) throw new Error(accepted.error);
    const finalPricePromo = promoFrom(accepted.potongan, "PCS");
    const bigger: PromoHitung = { ...finalPricePromo, id: "store", name: "Diskon toko", unit: null, discountType: "percent", discountValue: 20 };
    const result = hitungPromoKeranjang([finalPricePromo, bigger], [line(20000, 1, "PCS")]);
    expect(result).toHaveLength(1); // one promo per line, never stacked
    expect(result[0]).toMatchObject({ promoName: "Diskon toko", potongan: 4000 });
    expect(paidCents(20000, 1, result[0].potongan)).toBeLessThan(1850000);
  });
});

describe("property sweep: accepted => register price == Harga Akhir; otherwise rejected", () => {
  const normals = [100, 1050, 1033, 1099, 2000, 5000, 10050, 12500, 99999, 100000, 150025, 2000050, 24000025];
  const centsRaw = (cents: number) => (cents / 100).toFixed(2);
  it("covers many normal/final pairs with the real engine at several quantities", () => {
    let accepted = 0, rejected = 0, fractionalNormalAccepted = 0;
    for (const normal of normals) {
      const finals = new Set<number>();
      for (let step = 0; step <= 40; step++) finals.add(Math.round((normal * step) / 40));
      for (const extra of [1, 25, 33, 50, 67, 99, 100, 101, 150, 199, 200]) { finals.add(extra); finals.add(normal - extra); finals.add(normal + extra); }
      finals.add(normal); finals.add(0);
      for (const final of finals) {
        if (final < 0) continue;
        const result = convertFinalPrice(input(centsRaw(final), { item: ITEM(centsRaw(normal)) }));
        const expectOk = final > 0 && final < normal && (normal - final) % 100 === 0;
        expect({ normal, final, ok: result.ok }).toEqual({ normal, final, ok: expectOk });
        if (!result.ok) { rejected++; continue; }
        accepted++;
        if (normal % 100 !== 0) fractionalNormalAccepted++;
        const promo = promoFrom(result.potongan, "PCS");
        for (const qty of [1, 2, 3, 7, 12]) {
          const potongan = potonganBaris(line(normal / 100, qty, "PCS"), promo);
          expect({ normal, final, qty, paid: paidCents(normal / 100, qty, potongan) }).toEqual({ normal, final, qty, paid: final * qty });
        }
      }
    }
    expect(accepted).toBeGreaterThan(100);
    expect(rejected).toBeGreaterThan(100);
    expect(fractionalNormalAccepted).toBeGreaterThan(5);
  });
});
