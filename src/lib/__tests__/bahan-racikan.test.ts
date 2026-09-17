import { describe, expect, it } from "vitest";
import { filterBahanRacikan, idsBahanTerlihat } from "../bahan-racikan";

const rows = [
  { id: "obat-1", code: "OBT001", name: "Amoxicillin", kategori: "ANTIBIOTIK", sell_price: 1_000, is_compound_material: true },
  { id: "obat-2", code: "OBT002", name: "Vitamin", kategori: "VITAMIN", sell_price: 2_000, is_compound_material: false },
  { id: "pasir-1", code: "LTR001", name: "Pasir Kucing", kategori: "BENTONIT", sell_price: 3_000, is_compound_material: false },
];

describe("filter bahan racikan", () => {
  it("awal hanya menampilkan bahan yang sudah dipilih", () => {
    expect(filterBahanRacikan(rows, { q: "", kategori: "__selected__" }).map((r) => r.id)).toEqual(["obat-1"]);
  });

  it("kategori membatasi kandidat agar barang lain tidak ikut tampil", () => {
    expect(filterBahanRacikan(rows, { q: "", kategori: "VITAMIN" }).map((r) => r.id)).toEqual(["obat-2"]);
  });

  it("pencarian berlaku di dalam kategori aktif", () => {
    expect(filterBahanRacikan(rows, { q: "OBT002", kategori: "VITAMIN" }).map((r) => r.id)).toEqual(["obat-2"]);
    expect(filterBahanRacikan(rows, { q: "pasir", kategori: "VITAMIN" })).toEqual([]);
  });

  it("pilih semua hanya mengirim id hasil filter", () => {
    expect(idsBahanTerlihat(rows, { q: "", kategori: "VITAMIN" })).toEqual(["obat-2"]);
  });
});
