import { describe, expect, it } from "vitest";
import {
  akumulasiFiskal, jurnalPelepasan, jurnalTambahNilai, nilaiBuku,
  penyusutanFiskalTahunKe, tahunBerjalan, type GolonganPajak,
} from "../aset";

const seimbang = (l: { debit: number; credit: number }[]) =>
  l.reduce((a, x) => a + x.debit, 0) === l.reduce((a, x) => a + x.credit, 0);

const golI: GolonganPajak = { umurBulan: 48, metode: "saldo_menurun", tarifPersen: 50 };
const bangunan: GolonganPajak = { umurBulan: 240, metode: "garis_lurus", tarifPersen: 5 };

describe("penyusutanFiskalTahunKe", () => {
  it("garis lurus: rata sepanjang masa manfaat", () => {
    expect(penyusutanFiskalTahunKe(240_000_000, bangunan, 1)).toBe(12_000_000);
    expect(penyusutanFiskalTahunKe(240_000_000, bangunan, 20)).toBe(12_000_000);
  });

  it("garis lurus: tahun terakhir menutup sisa pembulatan", () => {
    const g: GolonganPajak = { umurBulan: 36, metode: "garis_lurus", tarifPersen: 0 };
    const total = [1, 2, 3].reduce((a, t) => a + penyusutanFiskalTahunKe(10_000_000, g, t), 0);
    expect(total).toBe(10_000_000);
  });

  it("saldo menurun: tarif dikali nilai buku awal tahun", () => {
    expect(penyusutanFiskalTahunKe(100_000_000, golI, 1)).toBe(50_000_000);
    expect(penyusutanFiskalTahunKe(100_000_000, golI, 2)).toBe(25_000_000);
    expect(penyusutanFiskalTahunKe(100_000_000, golI, 3)).toBe(12_500_000);
  });

  it("saldo menurun: tahun terakhir menyusutkan habis sisanya", () => {
    // Tanpa aturan ini, 6,25 jt akan menggantung selamanya.
    expect(penyusutanFiskalTahunKe(100_000_000, golI, 4)).toBe(12_500_000);
    expect(akumulasiFiskal(100_000_000, golI, 4)).toBe(100_000_000);
  });

  it("di luar masa manfaat = nol", () => {
    expect(penyusutanFiskalTahunKe(100_000_000, golI, 0)).toBe(0);
    expect(penyusutanFiskalTahunKe(100_000_000, golI, 5)).toBe(0);
  });

  it("akumulasi tidak pernah melebihi harga perolehan", () => {
    expect(akumulasiFiskal(100_000_000, golI, 99)).toBe(100_000_000);
  });
});

describe("tahunBerjalan", () => {
  it("tahun perolehan dihitung tahun ke-1", () => {
    expect(tahunBerjalan("2026-08-03", "2026-12-31")).toBe(1);
    expect(tahunBerjalan("2026-08-03", "2027-01-01")).toBe(2);
  });
});

describe("nilaiBuku", () => {
  it("harga perolehan dikurangi akumulasi, tidak negatif", () => {
    expect(nilaiBuku(10_000_000, 4_000_000)).toBe(6_000_000);
    expect(nilaiBuku(10_000_000, 12_000_000)).toBe(0);
  });
});

describe("jurnalPelepasan", () => {
  it("dijual di atas nilai buku → laba", () => {
    const l = jurnalPelepasan(10_000_000, 6_000_000, 5_000_000, "1102");
    expect(l).toEqual([
      { code: "1509", debit: 6_000_000, credit: 0 },
      { code: "1102", debit: 5_000_000, credit: 0 },
      { code: "1501", debit: 0, credit: 10_000_000 },
      { code: "4302", debit: 0, credit: 1_000_000 },
    ]);
    expect(seimbang(l)).toBe(true);
  });

  it("dijual di bawah nilai buku → rugi", () => {
    const l = jurnalPelepasan(10_000_000, 6_000_000, 3_000_000, "1102");
    expect(l.find((x) => x.code === "5602")?.debit).toBe(1_000_000);
    expect(seimbang(l)).toBe(true);
  });

  it("dihapus tanpa hasil penjualan → rugi sebesar nilai buku", () => {
    const l = jurnalPelepasan(10_000_000, 4_000_000, 0, "1102");
    expect(l.some((x) => x.code === "1102")).toBe(false);
    expect(l.find((x) => x.code === "5602")?.debit).toBe(6_000_000);
    expect(seimbang(l)).toBe(true);
  });

  it("aset yang sudah habis disusutkan: seluruh harga perolehan dihapus lewat akumulasi", () => {
    const l = jurnalPelepasan(10_000_000, 10_000_000, 0, "1102");
    expect(l).toEqual([
      { code: "1509", debit: 10_000_000, credit: 0 },
      { code: "1501", debit: 0, credit: 10_000_000 },
    ]);
    expect(seimbang(l)).toBe(true);
  });

  it("akumulasi yang kelebihan dibatasi harga perolehan supaya jurnal tetap seimbang", () => {
    const l = jurnalPelepasan(10_000_000, 99_000_000, 0, "1102");
    expect(seimbang(l)).toBe(true);
  });

  it("harga perolehan nol tidak menghasilkan jurnal", () => {
    expect(jurnalPelepasan(0, 0, 0, "1102")).toEqual([]);
  });
});

describe("jurnalTambahNilai", () => {
  it("perbaikan besar menambah nilai aset, bukan jadi beban", () => {
    const l = jurnalTambahNilai(2_500_000, "1101");
    expect(l).toEqual([
      { code: "1501", debit: 2_500_000, credit: 0 },
      { code: "1101", debit: 0, credit: 2_500_000 },
    ]);
    expect(seimbang(l)).toBe(true);
  });

  it("nol atau negatif tidak menghasilkan jurnal", () => {
    expect(jurnalTambahNilai(0, "1101")).toEqual([]);
    expect(jurnalTambahNilai(-100, "1101")).toEqual([]);
  });
});
