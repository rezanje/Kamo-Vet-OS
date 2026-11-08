import { describe, expect, it, vi } from "vitest";
import { bacaRincianPromoKlinik, catatRincianPromoKlinik, labelDiskonBaris, pasangPromoKeBaris } from "@/lib/rincian-promo-klinik";
import { rincianPromoPerBarang } from "@/lib/tagihan-klinik";
import { labelDiskonManual, labelPromo } from "@/lib/label-potongan";

const A = "a0000000-0000-4000-8000-000000000001";
const B = "b0000000-0000-4000-8000-000000000002";
const P = "c0000000-0000-4000-8000-000000000003";
const INV = "d0000000-0000-4000-8000-000000000004";

describe("rincianPromoPerBarang", () => {
  it("menjumlahkan promo yang sama untuk barang yang sama dan membuang baris tanpa barang", () => {
    expect(rincianPromoPerBarang([
      { item_id: A, promoId: P, promoName: "Icarae MBC", potongan: 2000 },
      { item_id: A, promoId: P, promoName: "Icarae MBC", potongan: 3000 },
      { item_id: "", promoId: P, promoName: "Icarae MBC", potongan: 9000 },
      { item_id: B, promoId: P, promoName: "Icarae MBC", potongan: 0 },
    ])).toEqual([{ item_id: A, promo_id: P, promo_name: "Icarae MBC", potongan: 5000 }]);
  });
});

describe("pasangPromoKeBaris", () => {
  const lines = [
    { sources: [{ item_id: B }] },
    { sources: [{ item_id: "x" }, { item_id: A }] }, // baris paket: salah satu isinya kena promo
    { sources: [{ item_id: A }] },
  ];
  it("menempelkan promo ke baris pertama yang memuat barangnya", () => {
    const hasil = pasangPromoKeBaris(lines, [{ item_id: A, promo_name: "Icarae MBC", potongan: 27000 }], 30000);
    expect(hasil.perBaris).toEqual([[], [{ nama: "Icarae MBC", potongan: 27000 }], []]);
    expect(hasil.totalPromo).toBe(27000);
  });
  it("tidak pernah menempelkan lebih dari diskon invoice (sisanya tetap diskon transaksi)", () => {
    const hasil = pasangPromoKeBaris(lines, [
      { item_id: B, promo_name: "Satu", potongan: 10000 },
      { item_id: A, promo_name: "Dua", potongan: 10000 },
    ], 15000);
    expect(hasil.totalPromo).toBe(10000);
    expect(hasil.perBaris[0]).toEqual([{ nama: "Satu", potongan: 10000 }]);
    expect(hasil.perBaris[1]).toEqual([]);
  });
  it("promo untuk barang yang tidak tercetak tidak ditempel", () => {
    expect(pasangPromoKeBaris(lines, [{ item_id: "zzz", promo_name: "Hilang", potongan: 1000 }], 5000).totalPromo).toBe(0);
  });
});

describe("label", () => {
  it("tidak mengulang kata Promo", () => {
    expect(labelPromo("Icarae MBC")).toBe("Promo Icarae MBC");
    expect(labelPromo("PROMO Lebaran")).toBe("PROMO Lebaran");
    expect(labelPromo("Promosi Akhir Tahun")).toBe("Promo Promosi Akhir Tahun");
    expect(labelPromo("")).toBe("Promo");
  });
  it("diskon kasir memakai persen bila diketahui", () => {
    expect(labelDiskonManual(10)).toBe("Diskon 10%");
    expect(labelDiskonManual(null)).toBe("Diskon item");
    expect(labelDiskonBaris({ diskon_persen: 5, diskon: 1000 })).toBe("Diskon 5%");
    expect(labelDiskonBaris({ diskon_persen: null, diskon: 1000 })).toBe("Diskon item");
    expect(labelDiskonBaris({ diskon_persen: 0, diskon: 0 })).toBeNull();
  });
});

describe("baca/catat", () => {
  it("mencatat baris yang sah saja dan tidak pernah melempar galat", async () => {
    const insert = vi.fn(async () => ({ error: { code: "P0001", message: "PROMO_LINE_LEBIH" } }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await catatRincianPromoKlinik({ from: () => ({ insert }) }, INV, [
      { item_id: A, promo_id: P, promo_name: " Icarae MBC ", potongan: 27000.004 },
      { item_id: "bukan-uuid", promo_id: P, promo_name: "x", potongan: 1 },
    ]);
    expect(insert).toHaveBeenCalledWith([{ invoice_id: INV, item_id: A, promo_id: P, promo_name: "Icarae MBC", potongan: 27000 }]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
  it("tidak menulis apa pun tanpa invoice atau tanpa promo", async () => {
    const from = vi.fn();
    await catatRincianPromoKlinik({ from }, null, [{ item_id: A, promo_id: P, promo_name: "x", potongan: 1 }]);
    await catatRincianPromoKlinik({ from }, INV, []);
    expect(from).not.toHaveBeenCalled();
  });
  it("tabel belum terpasang = tampilan lama, tanpa galat", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const q = { select: () => q, in: () => q, order: () => q,
      then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data: null, error: { code: "PGRST205", message: "missing" } }).then(resolve) };
    const hasil = await bacaRincianPromoKlinik({ from: () => q }, [INV]);
    expect(hasil.size).toBe(0);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
  it("mengelompokkan per invoice", async () => {
    const data = [{ invoice_id: INV, item_id: A, promo_name: "Icarae MBC", potongan: "27000.00" }];
    const q = { select: () => q, in: () => q, order: () => q,
      then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) };
    const hasil = await bacaRincianPromoKlinik({ from: () => q }, [INV, ""]);
    expect(hasil.get(INV)).toEqual([{ invoice_id: INV, item_id: A, promo_name: "Icarae MBC", potongan: 27000 }]);
  });
});
