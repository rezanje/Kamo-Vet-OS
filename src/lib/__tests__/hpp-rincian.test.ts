import { describe, expect, it } from "vitest";
import { alokasiHppFaktur, rincianHppFaktur } from "../hpp-rincian";

describe("alokasiHppFaktur", () => {
  it("mengunci HPP dari lapisan kiriman yang belum pernah ditagih", () => {
    expect(alokasiHppFaktur({
      orderItemId: "a",
      qtySudahFaktur: 1,
      qtyFakturBaru: 2,
      kiriman: [
        { orderItemId: "a", qty: 2, hpp: 20_000 },
        { orderItemId: "a", qty: 3, hpp: 45_000 },
      ],
    })).toBe(25_000);
  });

  it("tidak mengambil modal barang lain", () => {
    expect(alokasiHppFaktur({
      orderItemId: "a",
      qtySudahFaktur: 0,
      qtyFakturBaru: 1,
      kiriman: [{ orderItemId: "b", qty: 1, hpp: 99_000 }],
    })).toBe(0);
  });
});

describe("rincianHppFaktur", () => {
  it("membagi HPP kiriman bertahap ke qty yang ditagih pada faktur", () => {
    const rows = rincianHppFaktur(
      [{ orderItemId: "a", nama: "Makanan A", qty: 4, satuan: "pcs" }],
      [
        { orderItemId: "a", qty: 2, hpp: 20_000 },
        { orderItemId: "a", qty: 3, hpp: 45_000 },
      ],
    );

    expect(rows).toEqual([
      { nama: "Makanan A", qty: 4, satuan: "pcs", hpp: 52_000 },
    ]);
  });

  it("tidak mencampur HPP antar barang dan menganggap jasa tanpa HPP bernilai nol", () => {
    const rows = rincianHppFaktur(
      [
        { orderItemId: "a", nama: "Makanan A", qty: 1, satuan: "pcs" },
        { orderItemId: "b", nama: "Jasa Kirim", qty: 1, satuan: null },
      ],
      [
        { orderItemId: "a", qty: 2, hpp: 20_000 },
        { orderItemId: "c", qty: 1, hpp: 99_000 },
      ],
    );

    expect(rows).toEqual([
      { nama: "Makanan A", qty: 1, satuan: "pcs", hpp: 10_000 },
      { nama: "Jasa Kirim", qty: 1, satuan: "unit", hpp: 0 },
    ]);
  });
});
