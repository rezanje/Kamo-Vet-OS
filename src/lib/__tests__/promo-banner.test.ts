import { describe, expect, it } from "vitest";
import { composeSyaratHasilCart, type ShRow } from "@/lib/promo-syarat-hasil-checkout";
import { hitungPromoKeranjang, type PromoHitung } from "@/lib/promo-hitung";
import { serviceLinePromos } from "@/lib/service-line-promos";
import { computeTotals, lineDiscount, linePromoApplied } from "@/lib/pos-calc";
import { ringkasBannerPromo, type PromoBannerRow } from "@/lib/promo-banner";

// Kasus 24 Nov: iCare B1G1 (50%, min 2, kelipatan) + barang dengan diskon bawaan master 20%. 2 x Rp45.000.
const b1g1 = { id: "icare", name: "iCare B1G1 Petshop", itemIds: ["recovery"], unit: null, minQty: 2, maxQty: null, kelipatan: true, autoApply: true, discountType: "percent", discountValue: 50, minSubtotal: null } as unknown as PromoHitung;
const baris = (extra: Partial<ShRow> = {}): ShRow & { nama: string } => ({ item_id: "recovery", nama: "Icare Can Recovery", qty: 2, harga: 45_000, satuan: "PCS", faktor: 1, officialPrice: 45_000, item_type: "Persediaan", ...extra });
const compose = (rows: ShRow[], promo: PromoHitung = b1g1) => composeSyaratHasilCart({
  rows, defs: [], legacy: (list, only) => serviceLinePromos(only === undefined ? [promo] : [promo].filter((p) => p.id === only), list as never), legacyPromos: [{ id: promo.id, name: promo.name }],
});
const sebagaiBaris = (rows: unknown) => rows as PromoBannerRow[];

describe("banner Promo diterapkan = potongan yang benar-benar masuk total", () => {
  it("diskon bawaan 20%: mesin promo menghitung 45.000 tetapi total hanya memotong 18.000 (banner lama: 'hemat 45.000')", () => {
    const hasil = compose([baris({ item_discount_type: "percent", item_discount_value: 20 })]);
    expect(hasil.applied.map((a) => [a.promo_id, a.discount])).toEqual([["icare", 45_000]]); // angka mentah mesin = sumber banner lama
    const line = sebagaiBaris(hasil.rows)[0];
    expect(lineDiscount(line)).toBe(18_000);
    expect(linePromoApplied(line)).toBe(0);
    expect(computeTotals([line], 0, 0, 0).total).toBe(72_000);
    const r = ringkasBannerPromo(hasil.applied, sebagaiBaris(hasil.rows));
    expect(r.dipakai).toEqual([]); // tidak ada "hemat Rp45.000"
    expect(r.tertimpa).toEqual([{ promo_id: "icare", name: "iCare B1G1 Petshop", promoDiscount: 45_000, itemDiscount: 18_000, itemDiscountLabel: "20%", barang: ["Icare Can Recovery"] }]);
  });
  it("tanpa diskon barang: B1G1 dipakai penuh, banner 45.000 dan total 45.000", () => {
    const hasil = compose([baris()]);
    expect(computeTotals([sebagaiBaris(hasil.rows)[0]], 0, 0, 0).total).toBe(45_000);
    const r = ringkasBannerPromo(hasil.applied, sebagaiBaris(hasil.rows));
    expect(r.dipakai).toEqual([{ promo_id: "icare", name: "iCare B1G1 Petshop", discount: 45_000 }]);
    expect(r.tertimpa).toEqual([]);
  });
  it("item_discount_value 0 (seperti POS-20261111-0019) tidak dianggap diskon barang", () => {
    const hasil = compose([baris({ item_discount_type: "percent", item_discount_value: 0 })]);
    const r = ringkasBannerPromo(hasil.applied, sebagaiBaris(hasil.rows));
    expect(r.dipakai[0].discount).toBe(45_000); expect(r.tertimpa).toEqual([]);
  });
  it("keranjang campur: promo menang di satu baris, kalah di baris lain; banner menjumlah hanya yang masuk", () => {
    const promo2 = { ...b1g1, itemIds: ["recovery", "mbc"] } as PromoHitung;
    const rows = [baris({ item_id: "mbc", nama: "Icare Can MBC", harga: 40_000, officialPrice: 40_000 }), baris({ item_discount_type: "percent", item_discount_value: 20 })];
    const hasil = compose(rows, promo2);
    expect(hasil.applied[0].discount).toBe(40_000 + 45_000);
    const r = ringkasBannerPromo(hasil.applied, sebagaiBaris(hasil.rows));
    expect(r.dipakai[0].discount).toBe(40_000); // hanya baris MBC
    expect(r.tertimpa[0]).toMatchObject({ promoDiscount: 45_000, itemDiscount: 18_000, barang: ["Icare Can Recovery"] });
    const total = computeTotals(sebagaiBaris(hasil.rows), 0, 0, 0);
    expect(total.itemDiscountTotal).toBe(40_000 + 18_000); // banner (40.000) + diskon barang (18.000) = potongan total
  });
  it("diskon nominal ketikan kasir juga dijelaskan (label Rp)", () => {
    const hasil = compose([baris({ item_discount_type: "nominal", item_discount_value: 5_000 })]);
    const r = ringkasBannerPromo(hasil.applied, sebagaiBaris(hasil.rows));
    expect(r.tertimpa[0].itemDiscountLabel).toBe("Rp5.000"); expect(r.tertimpa[0].itemDiscount).toBe(5_000);
  });
  it("promo syarat-hasil (kind syarat_hasil) tidak diubah", () => {
    const r = ringkasBannerPromo([{ promo_id: "s", name: "Free ANC", discount: 3_000, kind: "syarat_hasil" }], []);
    expect(r.dipakai).toEqual([{ promo_id: "s", name: "Free ANC", discount: 3_000 }]);
  });
  it("kontrak uang tidak berubah: mesin promo tetap 45.000 dan diskon barang tetap menang (18.000)", () => {
    expect(hitungPromoKeranjang([b1g1], [{ item_id: "recovery", qty: 2, harga: 45_000, satuan: "PCS", item_discount_type: "percent", item_discount_value: 20 }])[0].potongan).toBe(45_000);
    expect(lineDiscount({ qty: 2, harga: 45_000, item_discount_type: "percent", item_discount_value: 20, promo_discount: 45_000 })).toBe(18_000);
  });
});
