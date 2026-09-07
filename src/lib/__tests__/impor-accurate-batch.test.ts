import { describe, expect, it } from "vitest";
import { bacaProgresDariRingkasan, bagiImporBatch, hitungProgresImpor } from "../impor-accurate-batch";

describe("bagiImporBatch", () => {
  it("membagi impor besar menjadi batch kecil tanpa mengubah urutan", () => {
    expect(bagiImporBatch([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("hitungProgresImpor", () => {
  it("melaporkan persen proses dari jumlah baris yang sudah selesai", () => {
    expect(hitungProgresImpor(75, 300)).toEqual({ completed: 75, total: 300, percentage: 25 });
  });

  it("membatasi progres agar tidak melewati seratus persen", () => {
    expect(hitungProgresImpor(12, 10)).toEqual({ completed: 10, total: 10, percentage: 100 });
  });

  it("membaca progres tersimpan tanpa mempercayai angka di luar batas", () => {
    expect(bacaProgresDariRingkasan({ progress: { phase: "mengimpor", completed: 101, total: 100 } }))
      .toEqual({ phase: "mengimpor", completed: 100, total: 100, percentage: 100 });
  });

  it("memulai dari nol bila progres belum tersimpan", () => {
    expect(bacaProgresDariRingkasan({})).toEqual({ phase: "menyiapkan", completed: 0, total: 0, percentage: 100 });
  });
});
