import { describe, expect, it } from "vitest";
import { alokasiPromoPerBaris } from "../promo-baris-klinik";
import { hitungPromoKeranjang, type PromoHitung } from "../promo-hitung";
import { nilaiBaris, rincianPromoPerBarang } from "../tagihan-klinik";

// Kasus 11 Nov 2026 (kasir klinik Panduraya): kode kampanye GROOM11 = 50% hanya untuk jasa grooming.
// Nota: Anthel Cat 1 x Rp18.000 (HPP Rp11.287,29) + Grooming VET Lengkap 1 x Rp90.000.
const ANTHEL = "item-anthel";
const GROOM = "item-grooming";
const GROOM11: PromoHitung = {
  id: "promo-groom11", name: "Grooming 11.11", itemIds: [GROOM, "item-grooming-b"], minQty: null, maxQty: null,
  kelipatan: false, autoApply: true, discountType: "percent", discountValue: 50,
};
const HPP_ANTHEL = 11287.29;

/** Aturan lantai di database (assert_invoice_price_floor, migrasi 20261111140000), untuk baris obat: neto >= HPP. */
function netoBaris(nilai: number[], promo: number[], diskonInvoice: number, i: number): number {
  const subtotal = nilai.reduce((a, b) => a + b, 0);
  const jumlahPromo = promo.reduce((a, b) => a + b, 0);
  const pakaiPromo = jumlahPromo > 0 && jumlahPromo <= diskonInvoice;
  const p = pakaiPromo ? jumlahPromo : 0;
  const bagi = subtotal - p > 0 ? (subtotal - diskonInvoice) / (subtotal - p) : 0;
  return Math.round(((nilai[i] - (pakaiPromo ? promo[i] : 0)) * bagi) * 100) / 100;
}

describe("GROOM11 di lapisan murni: mesin promo -> rincian -> potongan per baris -> lantai", () => {
  const rows = [
    { deskripsi: "Anthel Cat", qty: 1, harga: 18000, jenis: "obat", item_id: ANTHEL, satuan: "pcs" },
    { deskripsi: "Grooming VET Lengkap", qty: 1, harga: 90000, jenis: "jasa", item_id: GROOM, satuan: "jasa" },
  ];
  const mesin = hitungPromoKeranjang([GROOM11], rows.map((r) => ({
    item_id: r.item_id, qty: r.qty, harga: r.harga, satuan: r.satuan, item_type: r.jenis === "jasa" ? "Jasa" : "Persediaan",
  })));
  const rincian = rincianPromoPerBarang(mesin);
  const subtotal = rows.reduce((a, l) => a + nilaiBaris(l), 0);

  it("mesin promo hanya memotong Grooming (Rp45.000); Anthel tidak kena", () => {
    expect(mesin.map((m) => [m.item_id, m.potongan])).toEqual([[GROOM, 45000]]);
    expect(subtotal).toBe(108000);
  });

  it("potongan promo per baris: seluruhnya di baris Grooming, Anthel 0", () => {
    expect(alokasiPromoPerBaris(rows, rincian, 45000)).toEqual([0, 45000]);
  });

  it("lantai: dengan promo per baris Anthel tetap Rp18.000 (>= HPP); tanpanya Rp10.500 (kasus yang ditolak)", () => {
    const nilai = rows.map(nilaiBaris);
    const promo = alokasiPromoPerBaris(rows, rincian, 45000);
    expect(netoBaris(nilai, promo, 45000, 0)).toBe(18000);
    expect(netoBaris(nilai, promo, 45000, 0)).toBeGreaterThanOrEqual(HPP_ANTHEL);
    expect(netoBaris(nilai, [0, 0], 45000, 0)).toBe(10500);
    expect(netoBaris(nilai, [0, 0], 45000, 0)).toBeLessThan(HPP_ANTHEL);
  });

  it("voucher/poin/manual tetap dibagi: promo 45.000 + diskon lain 25.000 menurunkan Anthel ke Rp10.857 (di bawah HPP, tetap ditolak)", () => {
    const nilai = rows.map(nilaiBaris);
    const promo = alokasiPromoPerBaris(rows, rincian, 70000);
    expect(promo).toEqual([0, 45000]);
    expect(netoBaris(nilai, promo, 70000, 0)).toBe(10857.14);
    expect(netoBaris(nilai, promo, 70000, 0)).toBeLessThan(HPP_ANTHEL);
  });
});

describe("alokasiPromoPerBaris", () => {
  const baris = (item_id: string | null, qty: number, harga: number, diskon_persen = 0) => ({ item_id, qty, harga, diskon_persen });
  const rin = (item_id: string, potongan: number) => ({ item_id, potongan });

  it("tanpa rincian, tanpa diskon, tanpa baris cocok = semua 0 (perilaku lama)", () => {
    const r = [baris("a", 1, 1000), baris("b", 1, 2000)];
    expect(alokasiPromoPerBaris(r, undefined, 500)).toEqual([0, 0]);
    expect(alokasiPromoPerBaris(r, [], 500)).toEqual([0, 0]);
    expect(alokasiPromoPerBaris(r, [rin("a", 500)], 0)).toEqual([0, 0]);
    expect(alokasiPromoPerBaris(r, [rin("zzz", 500)], 500)).toEqual([0, 0]);
    expect(alokasiPromoPerBaris(r, [rin("a", 0)], 500)).toEqual([0, 0]);
    expect(alokasiPromoPerBaris(r, [rin("a", -50)], 500)).toEqual([0, 0]);
    expect(alokasiPromoPerBaris([], [rin("a", 50)], 500)).toEqual([]);
  });

  it("barang yang sama di beberapa baris: dibagi sebanding nilai baris, jumlah tepat sama", () => {
    const r = [baris("g", 1, 60000), baris("x", 1, 5000), baris("g", 1, 30000)];
    expect(alokasiPromoPerBaris(r, [rin("g", 45000)], 45000)).toEqual([30000, 0, 15000]);
  });

  it("sisa sen ditempel ke baris terbesar; tiap baris <= nilainya; jumlah persis", () => {
    const r = [baris("g", 1, 100), baris("g", 1, 100), baris("g", 1, 100)];
    const hasil = alokasiPromoPerBaris(r, [rin("g", 100.01)], 1000);
    expect(hasil.reduce((a, b) => a + b, 0)).toBeCloseTo(100.01, 10);
    hasil.forEach((h) => { expect(h).toBeLessThanOrEqual(100); expect(Math.round(h * 100) / 100).toBe(h); });
    expect([...hasil].sort()).toEqual([33.33, 33.34, 33.34].sort());
  });

  it("promo melebihi nilai baris dijepit ke nilai baris", () => {
    expect(alokasiPromoPerBaris([baris("g", 1, 1000)], [rin("g", 5000)], 9000)).toEqual([1000]);
  });

  it("nilai baris memakai diskon baris persen (setelah diskon baris)", () => {
    // 90.000 diskon 10% = 81.000; promo 40.500 muat; promo 90.000 dijepit ke 81.000
    expect(alokasiPromoPerBaris([baris("g", 1, 90000, 10)], [rin("g", 40500)], 40500)).toEqual([40500]);
    expect(alokasiPromoPerBaris([baris("g", 1, 90000, 10)], [rin("g", 90000)], 90000)).toEqual([81000]);
  });

  it("qty > 1 dan harga desimal; baris qty 0 diabaikan", () => {
    expect(alokasiPromoPerBaris([baris("g", 3, 33.33), baris("g", 0, 999)], [rin("g", 50)], 50)).toEqual([50, 0]);
    expect(alokasiPromoPerBaris([baris("g", 3, 33.33)], [rin("g", 500)], 500)).toEqual([99.99]);
  });

  it("jumlah seluruh baris tidak pernah melebihi diskon invoice (baris terbesar dikurangi dulu)", () => {
    const r = [baris("a", 1, 10000), baris("b", 1, 50000)];
    const hasil = alokasiPromoPerBaris(r, [rin("a", 5000), rin("b", 25000)], 20000);
    expect(hasil.reduce((a, b) => a + b, 0)).toBe(20000);
    expect(hasil).toEqual([5000, 15000]);
  });

  it("dua promo untuk barang yang sama dijumlah", () => {
    expect(alokasiPromoPerBaris([baris("g", 1, 90000)], [rin("g", 10000), rin("g", 5000)], 15000)).toEqual([15000]);
  });

  it("sifat acak (deterministik): >= 0, <= nilai baris, <= diskon invoice, 2 desimal, tidak lebih dari rincian, dan penuh bila muat", () => {
    let seed = 12345;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let n = 0; n < 2000; n++) {
      const jumlah = 1 + Math.floor(rand() * 6);
      const r = Array.from({ length: jumlah }, () => baris(["a", "b", "c", null][Math.floor(rand() * 4)], 1 + Math.floor(rand() * 5),
        Math.round(rand() * 200000) / 100, [0, 0, 10, 33.33, 100][Math.floor(rand() * 5)]));
      const rincian = ["a", "b", "c"].map((i) => rin(i, Math.round(rand() * 300000) / 100));
      const diskon = Math.round(rand() * 800000) / 100;
      const hasil = alokasiPromoPerBaris(r, rincian, diskon);
      const sen = hasil.map((h) => Math.round(h * 100));
      sen.forEach((s, i) => {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(Math.abs(hasil[i] * 100 - s)).toBeLessThan(1e-6);
        const l = r[i];
        const nilaiSen = Math.floor((l.qty * Math.round(l.harga * 100) * (10000 - Math.round(l.diskon_persen * 100)) + 5000) / 10000);
        expect(s).toBeLessThanOrEqual(nilaiSen);
        if (!l.item_id || !["a", "b", "c"].includes(l.item_id)) expect(s).toBe(0);
      });
      expect(sen.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(Math.round(diskon * 100));
      ["a", "b", "c"].forEach((i) => {
        const jml = r.reduce((a, l, k) => a + (l.item_id === i ? sen[k] : 0), 0);
        expect(jml).toBeLessThanOrEqual(Math.round(rincian.find((x) => x.item_id === i)!.potongan * 100));
      });
    }
  });
});
