import { describe, expect, it } from "vitest";
import { kategoriKasirTerlihat } from "../kasir-kategori";

describe("kategoriKasirTerlihat", () => {
  const kategori = ["Semua", "Makanan", "Obat", "Aksesoris", "Pasir", "Mainan", "Vitamin"];

  it("meringkas kategori panjang pada tampilan awal", () => {
    expect(kategoriKasirTerlihat(kategori, false, "Semua", 3)).toEqual([
      "Semua", "Makanan", "Obat",
    ]);
  });

  it("tetap menampilkan kategori yang sedang dipilih saat diringkas", () => {
    expect(kategoriKasirTerlihat(kategori, false, "Vitamin", 3)).toEqual([
      "Semua", "Makanan", "Vitamin",
    ]);
  });

  it("menampilkan semua kategori setelah dibuka", () => {
    expect(kategoriKasirTerlihat(kategori, true, "Semua", 3)).toEqual(kategori);
  });
});
