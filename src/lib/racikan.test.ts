import { describe, it, expect } from "vitest";
import { alasanRacikanBelumLengkap, racikanTotal, type RacikanIngredient } from "./racikan";

describe("racikanTotal", () => {
  it("menjumlahkan harga × dosis tiap bahan", () => {
    const ings: RacikanIngredient[] = [
      { item_id: "a", nama: "Amoxicillin", qty: 10, satuan: "tablet", harga: 2000 },
      { item_id: "b", nama: "Sirup", qty: 1, satuan: "botol", harga: 25000 },
    ];
    expect(racikanTotal(ings)).toBe(45000); // 10*2000 + 1*25000
  });

  it("mengabaikan qty/harga negatif atau NaN (dianggap 0)", () => {
    const ings: RacikanIngredient[] = [
      { item_id: "a", nama: "x", qty: -5, satuan: "ml", harga: 1000 },
      { item_id: "b", nama: "y", qty: 2, satuan: "ml", harga: Number.NaN },
    ];
    expect(racikanTotal(ings)).toBe(0);
  });

  it("racikan kosong = 0", () => {
    expect(racikanTotal([])).toBe(0);
  });
});

describe("alasanRacikanBelumLengkap", () => {
  const bahan: RacikanIngredient[] = [{ item_id: "a", nama: "Bahan", qty: 1, satuan: "pcs", harga: 1000 }];
  const dasar = { skuDipilih: true, resepResmiDipilih: false, resepResmiTerisi: false, adaResepResmi: false, bolehManual: true, bahan };

  it("menyebut langkah yang kurang, satu per satu", () => {
    expect(alasanRacikanBelumLengkap({ ...dasar, skuDipilih: false })).toBe("Pilih obat racik dulu.");
    expect(alasanRacikanBelumLengkap({ ...dasar, bahan: [] })).toBe("Tambah minimal satu bahan racikan.");
    expect(alasanRacikanBelumLengkap({ ...dasar, bahan: [{ ...bahan[0], qty: 0 }] }))
      .toBe("Isi jumlah tiap bahan racikan lebih dari 0.");
    expect(alasanRacikanBelumLengkap({ ...dasar, resepResmiTerisi: true }))
      .toBe("Resep resmi yang dipilih sudah tidak berlaku. Pilih ulang komposisi racikan.");
  });

  it("tanpa izin racikan khusus, mengarahkan ke resep resmi atau ke Owner/Admin", () => {
    expect(alasanRacikanBelumLengkap({ ...dasar, bolehManual: false, adaResepResmi: true })).toBe("Pilih resep resmi dulu.");
    expect(alasanRacikanBelumLengkap({ ...dasar, bolehManual: false }))
      .toBe("Resep resmi belum ada — minta Owner/Admin aktifkan racikan khusus.");
  });

  it("racikan lengkap tidak punya alasan", () => {
    expect(alasanRacikanBelumLengkap(dasar)).toBe("");
    expect(alasanRacikanBelumLengkap({ ...dasar, resepResmiDipilih: true, resepResmiTerisi: true, bahan: [] })).toBe("");
  });
});
