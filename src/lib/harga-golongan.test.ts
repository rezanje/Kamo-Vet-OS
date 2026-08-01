import { describe, it, expect } from "vitest";
import {
  diskonGolongan, poinDidapat, RUPIAH_PER_POIN_DEFAULT,
  persenUntukBarang, diskonGolonganKeranjang,
  type AturanDiskon, type BarangDiskon,
} from "./harga-golongan";

describe("diskonGolongan", () => {
  it("persen normal dihitung dari subtotal", () => {
    expect(diskonGolongan(100000, 10)).toBe(10000);
    expect(diskonGolongan(150000, 2.5)).toBe(3750);
  });

  it("nol persen atau tanpa golongan = tidak ada diskon", () => {
    expect(diskonGolongan(100000, 0)).toBe(0);
  });

  it("seratus persen mentok di subtotal, tidak lebih", () => {
    expect(diskonGolongan(100000, 100)).toBe(100000);
  });

  it("pecahan rupiah dibulatkan, tidak menghasilkan sen", () => {
    expect(diskonGolongan(1005, 10)).toBe(101);
    expect(Number.isInteger(diskonGolongan(333, 33.33))).toBe(true);
  });

  it("subtotal nol atau negatif tidak pernah jadi diskon negatif", () => {
    expect(diskonGolongan(0, 25)).toBe(0);
    expect(diskonGolongan(-5000, 25)).toBe(0);
  });

  it("persen kotor dari data tetap ter-cap di [0, subtotal]", () => {
    expect(diskonGolongan(100000, -10)).toBe(0);
    expect(diskonGolongan(100000, 400)).toBe(100000);
    expect(diskonGolongan(100000, Number.NaN)).toBe(0);
  });
});

describe("poinDidapat", () => {
  it("golongan tanpa pengaturan sendiri = perilaku lama Rp1.000/poin", () => {
    expect(RUPIAH_PER_POIN_DEFAULT).toBe(1000);
    expect(poinDidapat(250_000, null)).toBe(250);
    expect(poinDidapat(250_000, undefined)).toBe(250);
  });

  it("golongan lebih royal dapat poin lebih banyak", () => {
    expect(poinDidapat(250_000, 500)).toBe(500);
    expect(poinDidapat(250_000, 2000)).toBe(125);
  });

  it("belanja belum genap tidak dihitung sebagian", () => {
    expect(poinDidapat(1_999, 1000)).toBe(1);
    expect(poinDidapat(999, 1000)).toBe(0);
  });

  it("nilai kotor tidak bikin poin ngawur", () => {
    expect(poinDidapat(0, 1000)).toBe(0);
    expect(poinDidapat(-5000, 1000)).toBe(0);
    expect(poinDidapat(100_000, 0)).toBe(100);      // rate 0 → jatuh ke default
    expect(poinDidapat(100_000, Number.NaN)).toBe(100);
  });
});

// ── Pengecualian per produk / kategori (migrasi 0082) ──────────────────────
const pakan: BarangDiskon = { item_id: "pakan", category_id: "kat-pakan", parent_category_id: "kat-induk" };
const obat: BarangDiskon = { item_id: "obat", category_id: "kat-obat", parent_category_id: null };

describe("persenUntukBarang", () => {
  it("tanpa pengecualian, semua barang pakai diskon dasar golongan", () => {
    expect(persenUntukBarang([], pakan, 5)).toBe(5);
    expect(persenUntukBarang([], obat, 5)).toBe(5);
  });

  it("aturan per kategori menang atas diskon dasar", () => {
    const a: AturanDiskon[] = [{ item_id: null, item_category_id: "kat-pakan", diskon_persen: 10 }];
    expect(persenUntukBarang(a, pakan, 5)).toBe(10);
    expect(persenUntukBarang(a, obat, 5)).toBe(5);   // kategori lain tidak kena
  });

  it("aturan per produk menang atas aturan kategorinya", () => {
    const a: AturanDiskon[] = [
      { item_id: null, item_category_id: "kat-pakan", diskon_persen: 10 },
      { item_id: "pakan", item_category_id: null, diskon_persen: 20 },
    ];
    expect(persenUntukBarang(a, pakan, 5)).toBe(20);
  });

  it("kategori induk dipakai kalau kategori anaknya tidak punya aturan", () => {
    const a: AturanDiskon[] = [{ item_id: null, item_category_id: "kat-induk", diskon_persen: 7 }];
    expect(persenUntukBarang(a, pakan, 5)).toBe(7);
  });

  it("aturan kategori anak menang atas kategori induk", () => {
    const a: AturanDiskon[] = [
      { item_id: null, item_category_id: "kat-induk", diskon_persen: 7 },
      { item_id: null, item_category_id: "kat-pakan", diskon_persen: 12 },
    ];
    expect(persenUntukBarang(a, pakan, 5)).toBe(12);
  });

  it("pengecualian 0% memang berarti tidak dapat diskon, bukan jatuh ke dasar", () => {
    // Ini yang bikin B2B bisa dapat 10% di pakan tapi 0% di obat.
    const a: AturanDiskon[] = [{ item_id: "obat", item_category_id: null, diskon_persen: 0 }];
    expect(persenUntukBarang(a, obat, 5)).toBe(0);
  });
});

describe("diskonGolonganKeranjang", () => {
  const info = new Map<string, BarangDiskon>([["pakan", pakan], ["obat", obat]]);
  const cart = [
    { item_id: "pakan", qty: 2, harga: 100_000 },
    { item_id: "obat", qty: 1, harga: 50_000 },
  ];

  it("tanpa pengecualian hasilnya sama dengan diskon rata seperti dulu", () => {
    // 5% dari 250.000 = 12.500
    expect(diskonGolonganKeranjang(cart, [], 5, info)).toBe(12_500);
  });

  it("tiap baris memakai persennya sendiri", () => {
    const a: AturanDiskon[] = [
      { item_id: null, item_category_id: "kat-pakan", diskon_persen: 10 },
      { item_id: "obat", item_category_id: null, diskon_persen: 0 },
    ];
    // pakan 10% dari 200.000 = 20.000; obat 0% = 0
    expect(diskonGolonganKeranjang(cart, a, 5, info)).toBe(20_000);
  });

  it("barang yang tidak dikenali jatuh ke diskon dasar, bukan error", () => {
    const asing = [{ item_id: "entah", qty: 1, harga: 100_000 }];
    expect(diskonGolonganKeranjang(asing, [], 5, info)).toBe(5_000);
  });

  it("keranjang kosong tidak menghasilkan diskon", () => {
    expect(diskonGolonganKeranjang([], [], 10, info)).toBe(0);
  });
});
