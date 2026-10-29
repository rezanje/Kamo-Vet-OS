import { describe, expect, it, vi } from "vitest";

// Promo klinik boleh mengenai jasa grooming, tindakan, dan obat — dibatasi
// daftar barang promo (promo_items). Yang diuji di sini: promo yang benar kena
// baris yang benar, DAN rupiahnya menempel pada baris invoice yang benar
// (atribusi per program), termasuk saat satu SKU jasa muncul dua kali.

const promos = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../promo-hitung", async original => ({
  ...await original<typeof import("../promo-hitung")>(),
  loadPromoAktif: async () => promos.list,
}));

import { hitungPotonganKlinik } from "../tagihan-klinik";
import { atribusiPotonganKlinik } from "../clinic-promo-attribution";

const promo = (over: Record<string, unknown>) => ({
  id: "promo", name: "Promo", itemIds: [], minQty: null, maxQty: null, kelipatan: false,
  autoApply: true, discountType: "percent", discountValue: 10, discountMode: "per_unit", minSubtotal: null,
  ...over,
});

const db = {} as never;

describe("potongan promo klinik per baris", () => {
  it("mengenai tindakan dan obat yang ditarget saja, dengan rupiah per baris asal", async () => {
    promos.list = [
      promo({ id: "promo-tindakan", name: "DISKON TINDAKAN", itemIds: ["tindakan-1"], discountType: "percent", discountValue: 10 }),
      promo({ id: "promo-obat", name: "DISKON OBAT", itemIds: ["obat-1"], discountType: "nominal", discountValue: 500 }),
    ];
    const hasil = await hitungPotonganKlinik(db, {
      branchId: "branch", customerId: null,
      rows: [
        { item_id: "tindakan-1", qty: 1, harga: 100000, jenis: "jasa", satuan: "jasa" },
        // Baris kosong harus dilewati TANPA menggeser nomor baris berikutnya.
        { item_id: "obat-3", qty: 0, harga: 1000, jenis: "obat", satuan: "box" },
        { item_id: "tindakan-1", qty: 1, harga: 100000, jenis: "jasa", satuan: "jasa" },
        { item_id: "obat-1", qty: 2, harga: 10000, jenis: "obat", satuan: "box" },
        { item_id: "obat-2", qty: 1, harga: 5000, jenis: "obat", satuan: "box" },
      ],
    });
    expect(hasil.promo).toBe(21000);
    expect(hasil.rincianPromo).toEqual([
      { lineIndex: 0, promoId: "promo-tindakan", promoName: "DISKON TINDAKAN", potongan: 10000 },
      { lineIndex: 2, promoId: "promo-tindakan", promoName: "DISKON TINDAKAN", potongan: 10000 },
      { lineIndex: 3, promoId: "promo-obat", promoName: "DISKON OBAT", potongan: 1000 },
    ]);
  });

  it("promo bertarget yang tidak cocok tidak berubah jadi promo semua barang", async () => {
    promos.list = [promo({ id: "promo-lain", name: "DISKON LAIN", itemIds: ["tindakan-9"] })];
    const hasil = await hitungPotonganKlinik(db, {
      branchId: "branch", customerId: null,
      rows: [{ item_id: "obat-1", qty: 1, harga: 10000, jenis: "obat", satuan: "box" }],
    });
    expect(hasil.promo).toBe(0);
    expect(hasil.rincianPromo).toEqual([]);
  });

  it("tanpa penggabungan jasa, tiap baris dihitung sendiri-sendiri", async () => {
    promos.list = [promo({ id: "promo-tindakan", name: "DISKON TINDAKAN", itemIds: ["tindakan-1"], minQty: 2 })];
    const rows = [
      { item_id: "tindakan-1", qty: 1, harga: 100000, jenis: "jasa", satuan: "jasa" },
      { item_id: "tindakan-1", qty: 1, harga: 100000, jenis: "jasa", satuan: "jasa" },
    ];
    const digabung = await hitungPotonganKlinik(db, { branchId: "branch", customerId: null, rows });
    const terpisah = await hitungPotonganKlinik(db, { branchId: "branch", customerId: null, rows, groupServices: false });
    // Syarat min. 2 terpenuhi hanya kalau kedua baris dihitung sebagai satu paket harga.
    expect(digabung.promo).toBe(20000);
    expect(terpisah.promo).toBe(0);
    expect(terpisah.rincianPromo).toEqual([]);
  });
});

describe("atribusi potongan ke kolom invoice", () => {
  const rincianPromo = [
    { lineIndex: 0, promoId: "promo-a", promoName: "A", potongan: 10000 },
    { lineIndex: 2, promoId: "promo-b", promoName: "B", potongan: 1000 },
  ];

  it("menyimpan promo per baris, voucher dan golongan terpisah saat muat di dalam diskon", () => {
    const hasil = atribusiPotonganKlinik({ rincianPromo, voucher: 2000, golongan: 1000, discount: 20000 });
    expect([...hasil.baris]).toEqual([
      [0, { promo_id: "promo-a", promo_discount: 10000 }],
      [2, { promo_id: "promo-b", promo_discount: 1000 }],
    ]);
    expect(hasil.voucher_discount).toBe(2000);
    expect(hasil.diskon_kategori).toBe(1000);
  });

  it("mengecilkan seluruh atribusi bila potongan sempat dibatasi nilai tagihan", () => {
    const hasil = atribusiPotonganKlinik({ rincianPromo, voucher: 2000, golongan: 1000, discount: 7000 });
    const jumlah = [...hasil.baris.values()].reduce((a, b) => a + b.promo_discount, 0)
      + hasil.voucher_discount + hasil.diskon_kategori;
    expect(jumlah).toBeLessThanOrEqual(7000);
    // 14.000 atribusi dibagi rata jadi separuhnya supaya muat di diskon 7.000.
    expect(hasil.baris.get(0)!.promo_discount).toBe(5000);
    expect(hasil.baris.get(2)!.promo_discount).toBe(500);
    expect(hasil.voucher_discount).toBe(1000);
    expect(hasil.diskon_kategori).toBe(500);
    expect(jumlah).toBe(7000);
  });

  it("tidak mencatat apa pun saat seluruh potongan nol", () => {
    const hasil = atribusiPotonganKlinik({ rincianPromo: [], voucher: 0, golongan: 0, discount: 0 });
    expect(hasil.baris.size).toBe(0);
    expect(hasil.voucher_discount).toBe(0);
    expect(hasil.diskon_kategori).toBe(0);
  });

  it("melewati baris yang promonya dikalahkan potongan lain", () => {
    const hasil = atribusiPotonganKlinik({
      rincianPromo: [{ lineIndex: 1, promoId: "promo-a", promoName: "A", potongan: 0 }],
      voucher: 0, golongan: 0, discount: 5000,
    });
    expect(hasil.baris.size).toBe(0);
  });
});
