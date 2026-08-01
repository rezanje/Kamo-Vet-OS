import { describe, expect, it } from "vitest";
import {
  qtyDapatPotongan, potonganBaris, hitungPromoKeranjang, totalPotonganPromo,
  type PromoHitung,
} from "../promo-hitung";

const promo = (p: Partial<PromoHitung> = {}): PromoHitung => ({
  id: "p1", name: "Diskon 10%", itemIds: [], minQty: null, maxQty: null,
  kelipatan: false, autoApply: true, discountType: "percent", discountValue: 10,
  minSubtotal: null, ...p,
});

describe("qtyDapatPotongan", () => {
  it("tanpa syarat minimum, seluruh qty dapat", () => {
    expect(qtyDapatPotongan(3, promo())).toBe(3);
  });

  it("di bawah minimum tidak dapat apa-apa", () => {
    expect(qtyDapatPotongan(1, promo({ minQty: 2 }))).toBe(0);
    expect(qtyDapatPotongan(2, promo({ minQty: 2 }))).toBe(2);
  });

  it("tanpa kelipatan: syarat terpenuhi = seluruh qty dapat", () => {
    expect(qtyDapatPotongan(5, promo({ minQty: 2, kelipatan: false }))).toBe(5);
  });

  it("dengan kelipatan: hanya kelipatan penuh yang dapat", () => {
    // min 2, beli 5 → 2 kelipatan = 4 dapat, sisa 1 harga normal.
    expect(qtyDapatPotongan(5, promo({ minQty: 2, kelipatan: true }))).toBe(4);
    expect(qtyDapatPotongan(6, promo({ minQty: 3, kelipatan: true }))).toBe(6);
    expect(qtyDapatPotongan(7, promo({ minQty: 3, kelipatan: true }))).toBe(6);
  });

  it("maksimum qty membatasi berapa pun yang dibeli", () => {
    expect(qtyDapatPotongan(10, promo({ maxQty: 3 }))).toBe(3);
    expect(qtyDapatPotongan(10, promo({ minQty: 2, kelipatan: true, maxQty: 5 }))).toBe(5);
  });
});

describe("potonganBaris", () => {
  it("persen dihitung per satuan lalu dikali qty yang kena", () => {
    expect(potonganBaris({ item_id: "a", qty: 3, harga: 10_000 }, promo())).toBe(3_000);
  });

  it("nominal adalah potongan PER SATUAN", () => {
    const p = promo({ discountType: "nominal", discountValue: 2_000 });
    expect(potonganBaris({ item_id: "a", qty: 3, harga: 10_000 }, p)).toBe(6_000);
  });

  it("nominal lebih besar dari harga tidak bikin baris jadi minus", () => {
    const p = promo({ discountType: "nominal", discountValue: 50_000 });
    expect(potonganBaris({ item_id: "a", qty: 2, harga: 10_000 }, p)).toBe(20_000);
  });

  it("promo tanpa diskon terpasang tidak memotong apa pun", () => {
    const p = promo({ discountType: null, discountValue: null });
    expect(potonganBaris({ item_id: "a", qty: 3, harga: 10_000 }, p)).toBe(0);
  });

  it("qty di bawah minimum tidak memotong", () => {
    const p = promo({ minQty: 3 });
    expect(potonganBaris({ item_id: "a", qty: 2, harga: 10_000 }, p)).toBe(0);
  });
});

describe("hitungPromoKeranjang", () => {
  const cart = [
    { item_id: "rc", qty: 2, harga: 100_000 },
    { item_id: "pedigree", qty: 1, harga: 50_000 },
  ];

  it("promo tanpa daftar barang kena semua baris", () => {
    const hasil = hitungPromoKeranjang([promo()], cart);
    expect(hasil).toHaveLength(2);
    expect(totalPotonganPromo(hasil)).toBe(20_000 + 5_000);
  });

  it("promo dengan daftar barang hanya kena barang itu", () => {
    const hasil = hitungPromoKeranjang([promo({ itemIds: ["rc"] })], cart);
    expect(hasil).toHaveLength(1);
    expect(hasil[0].item_id).toBe("rc");
    expect(hasil[0].potongan).toBe(20_000);
  });

  it("promo yang belum di-auto-apply tidak memotong (tetap sekadar pengingat)", () => {
    expect(hitungPromoKeranjang([promo({ autoApply: false })], cart)).toHaveLength(0);
  });

  it("syarat minimum belanja dicek dari total keranjang", () => {
    expect(hitungPromoKeranjang([promo({ minSubtotal: 1_000_000 })], cart)).toHaveLength(0);
    expect(hitungPromoKeranjang([promo({ minSubtotal: 200_000 })], cart)).toHaveLength(2);
  });

  it("satu baris hanya dapat satu promo — yang paling besar untuk pelanggan", () => {
    const kecil = promo({ id: "kecil", name: "Diskon 5%", discountValue: 5 });
    const besar = promo({ id: "besar", name: "Diskon 20%", discountValue: 20 });
    const hasil = hitungPromoKeranjang([kecil, besar], [{ item_id: "rc", qty: 1, harga: 100_000 }]);
    expect(hasil).toHaveLength(1);
    expect(hasil[0].promoId).toBe("besar");
    expect(hasil[0].potongan).toBe(20_000);
  });

  it("keranjang kosong tidak menghasilkan potongan", () => {
    expect(hitungPromoKeranjang([promo()], [])).toHaveLength(0);
  });

  it("kasus lengkap: beli 5, min 2, kelipatan, maks 4, potong Rp1.000/pcs", () => {
    const p = promo({
      minQty: 2, kelipatan: true, maxQty: 4,
      discountType: "nominal", discountValue: 1_000,
    });
    const hasil = hitungPromoKeranjang([p], [{ item_id: "a", qty: 5, harga: 10_000 }]);
    expect(hasil[0].qtyKena).toBe(4);
    expect(hasil[0].potongan).toBe(4_000);
  });
});
