import { describe, expect, it } from "vitest";
import {
  cicilanPeriode, cicilanSemuaKasbon, cicilanTertutupGaji, jadwalCicilan, sisaKasbon,
} from "../kasbon";

describe("jadwalCicilan", () => {
  it("membagi rata kalau habis dibagi", () => {
    expect(jadwalCicilan(3_000_000, 3)).toEqual([1_000_000, 1_000_000, 1_000_000]);
  });

  it("sisa pembulatan masuk ke cicilan terakhir, total tetap pas", () => {
    const c = jadwalCicilan(1_000_000, 3);
    expect(c).toEqual([333_333, 333_333, 333_334]);
    expect(c.reduce((a, b) => a + b, 0)).toBe(1_000_000);
  });

  it("tenor 1 = potong sekaligus", () => {
    expect(jadwalCicilan(750_000, 1)).toEqual([750_000]);
  });
});

describe("cicilanPeriode", () => {
  it("potongan bulan berjalan", () => {
    expect(cicilanPeriode(3_000_000, 3, 0)).toBe(1_000_000);
    expect(cicilanPeriode(3_000_000, 3, 1_000_000)).toBe(1_000_000);
  });

  it("cicilan terakhir menutup sisa, tidak melebihi utang", () => {
    expect(cicilanPeriode(1_000_000, 3, 666_666)).toBe(333_334);
  });

  it("sudah lunas = tidak ada potongan lagi", () => {
    expect(cicilanPeriode(1_000_000, 3, 1_000_000)).toBe(0);
    expect(cicilanPeriode(1_000_000, 3, 1_500_000)).toBe(0);
  });
});

describe("sisaKasbon", () => {
  it("tidak pernah negatif", () => {
    expect(sisaKasbon(500_000, 800_000)).toBe(0);
    expect(sisaKasbon(500_000, 200_000)).toBe(300_000);
  });
});

// ── Beberapa utang berjalan + gaji tidak cukup ───────────────────────────────

describe("cicilanSemuaKasbon", () => {
  it("membaca SEMUA utang, bukan cuma satu", () => {
    // Karyawan bisa punya kasbon yang ia ajukan + utang selisih kas dari tutup shift.
    const hasil = cicilanSemuaKasbon([
      { id: "A", jumlah: 1_200_000, tenor: 3, sudahDibayar: 0 },
      { id: "B", jumlah: 200_000, tenor: 1, sudahDibayar: 0 },
    ]);
    expect(hasil).toEqual([{ id: "A", jumlah: 400_000 }, { id: "B", jumlah: 200_000 }]);
  });

  it("utang yang sudah lunas tidak ikut", () => {
    expect(cicilanSemuaKasbon([{ id: "A", jumlah: 500_000, tenor: 1, sudahDibayar: 500_000 }])).toEqual([]);
  });
});

describe("cicilanTertutupGaji", () => {
  it("gaji cukup: semua cicilan dipotong penuh", () => {
    const c = [{ id: "A", jumlah: 400_000 }, { id: "B", jumlah: 200_000 }];
    expect(cicilanTertutupGaji(c, 5_000_000)).toEqual(c);
  });

  it("gaji tidak cukup: yang tercatat hanya sebesar yang tertutup gaji", () => {
    // Dulu cicilan dilaporkan PENUH walau gaji bersih diklem ke nol — sistem
    // mencatat utang lunas padahal uangnya tidak pernah dipotong.
    const hasil = cicilanTertutupGaji([{ id: "A", jumlah: 1_000_000 }], 300_000);
    expect(hasil).toEqual([{ id: "A", jumlah: 300_000 }]);
  });

  it("gaji nol: tidak ada cicilan yang tercatat", () => {
    expect(cicilanTertutupGaji([{ id: "A", jumlah: 1_000_000 }], 0)).toEqual([]);
    expect(cicilanTertutupGaji([{ id: "A", jumlah: 1_000_000 }], -50_000)).toEqual([]);
  });

  it("beberapa utang dibagi proporsional, totalnya persis sebesar gaji", () => {
    const hasil = cicilanTertutupGaji(
      [{ id: "A", jumlah: 600_000 }, { id: "B", jumlah: 400_000 }],
      500_000,
    );
    expect(hasil.reduce((a, c) => a + c.jumlah, 0)).toBe(500_000);
    expect(hasil).toHaveLength(2);
  });
});
