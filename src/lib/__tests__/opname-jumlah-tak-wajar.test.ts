import { describe, expect, it } from "vitest";
import { fmtJumlah, jumlahTakWajar, teksKemasan } from "../opname-jumlah-tak-wajar";

describe("jumlahTakWajar", () => {
  it("menandai lebih dari 10x stok sistem (sistem > 0), tepat 10x belum", () => {
    expect(jumlahTakWajar(1000, 1)).toBe(true);
    expect(jumlahTakWajar(11, 1)).toBe(true);
    expect(jumlahTakWajar(10.01, 1)).toBe(true);
    expect(jumlahTakWajar(10, 1)).toBe(false);
    expect(jumlahTakWajar(30, 3)).toBe(false);
    expect(jumlahTakWajar(31, 3)).toBe(true);
  });
  it("menandai >= 1000 bila sistem < 100, termasuk sistem 0 (kasus Shampoo 3000 padahal 0)", () => {
    expect(jumlahTakWajar(3000, 0)).toBe(true);
    expect(jumlahTakWajar(1000, 0)).toBe(true);
    expect(jumlahTakWajar(1000, 99.99)).toBe(true);
    expect(jumlahTakWajar(999, 0)).toBe(false);
    expect(jumlahTakWajar(999.99, 0)).toBe(false);
  });
  it("jumlah besar yang wajar karena sistemnya juga besar tidak ditandai", () => {
    expect(jumlahTakWajar(1000, 100)).toBe(false);
    expect(jumlahTakWajar(1200, 800)).toBe(false);
    expect(jumlahTakWajar(5000, 600)).toBe(false);
  });
  it("hitungan normal tidak ditandai, termasuk nol dan selisih kecil", () => {
    expect(jumlahTakWajar(0, 0)).toBe(false);
    expect(jumlahTakWajar(0, 50)).toBe(false);
    expect(jumlahTakWajar(5, 0)).toBe(false);
    expect(jumlahTakWajar(48, 50)).toBe(false);
    expect(jumlahTakWajar(100, 12)).toBe(false);
    expect(jumlahTakWajar(120, 12)).toBe(false);
  });
  it("angka tidak terbatas tidak ditandai (validasi ada di tempat lain)", () => {
    expect(jumlahTakWajar(Number.NaN, 1)).toBe(false);
    expect(jumlahTakWajar(5000, Number.NaN)).toBe(false);
    expect(jumlahTakWajar(Infinity, 1)).toBe(false);
  });
});

describe("fmtJumlah", () => {
  it("memakai format Indonesia", () => {
    expect(fmtJumlah(1000)).toBe("1.000");
    expect(fmtJumlah(0.5)).toBe("0,5");
    expect(fmtJumlah(3)).toBe("3");
  });
});

describe("teksKemasan", () => {
  it("menyebut isi satuan lain dalam satuan dasar", () => {
    expect(teksKemasan("ML", [{ unit: "btl", factor: 500 }])).toBe("1 btl = 500 ML");
  });
  it("beberapa satuan diurut dari kecil ke besar dan dibatasi", () => {
    expect(teksKemasan("pcs", [{ unit: "dus", factor: 24 }, { unit: "renteng", factor: 10 }])).toBe("1 renteng = 10 pcs · 1 dus = 24 pcs");
    expect(teksKemasan("pcs", [1, 2, 3, 4].map((n) => ({ unit: `u${n}`, factor: n * 10 })), 2)).toBe("1 u1 = 10 pcs · 1 u2 = 20 pcs");
  });
  it("tanpa data atau faktor tidak sah: tidak ada teks (tidak mengarang)", () => {
    expect(teksKemasan("ML", undefined)).toBeNull();
    expect(teksKemasan("ML", [])).toBeNull();
    expect(teksKemasan("ML", [{ unit: "ML", factor: 1 }])).toBeNull();
    expect(teksKemasan("ML", [{ unit: "btl", factor: 0 }, { unit: " ", factor: 5 }, { unit: "x", factor: Number.NaN }])).toBeNull();
  });
});
