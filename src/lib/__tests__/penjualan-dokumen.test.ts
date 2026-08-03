import { describe, expect, it } from "vitest";
import {
  formatNoDokumen, jurnalFakturJual, jurnalPengiriman, jurnalPenerimaan, jurnalUangMukaJual,
  pesananSelesai, sisaFaktur, sisaKirim, sisaTagihan, type BarisPesanan,
} from "../penjualan-dokumen";

const seimbang = (l: { debit: number; credit: number }[]) =>
  l.reduce((a, x) => a + x.debit, 0) === l.reduce((a, x) => a + x.credit, 0);

const baris = (o: Partial<BarisPesanan> = {}): BarisPesanan => ({
  id: "b1", qty: 10, qtyKirim: 0, qtyFaktur: 0, harga: 100_000, ...o,
});

describe("formatNoDokumen", () => {
  it("prefix per jenis dokumen", () => {
    expect(formatNoDokumen("SO", new Date(2026, 7, 3), 12)).toBe("SO.2026.08.00012");
    expect(formatNoDokumen("FJ", new Date(2026, 0, 1), 1)).toBe("FJ.2026.01.00001");
  });
});

describe("sisaKirim & sisaFaktur", () => {
  it("sisa kirim dibatasi qty pesanan", () => {
    expect(sisaKirim(baris({ qtyKirim: 4 }))).toBe(6);
    expect(sisaKirim(baris({ qtyKirim: 10 }))).toBe(0);
    expect(sisaKirim(baris({ qtyKirim: 12 }))).toBe(0);
  });

  it("sisa faktur dibatasi yang sudah DIKIRIM, bukan yang dipesan", () => {
    // Barang belum keluar gudang → belum boleh ditagih sama sekali.
    expect(sisaFaktur(baris())).toBe(0);
    expect(sisaFaktur(baris({ qtyKirim: 6 }))).toBe(6);
    expect(sisaFaktur(baris({ qtyKirim: 6, qtyFaktur: 4 }))).toBe(2);
    expect(sisaFaktur(baris({ qtyKirim: 6, qtyFaktur: 6 }))).toBe(0);
  });
});

describe("pesananSelesai", () => {
  it("selesai kalau semua terkirim dan tertagih penuh", () => {
    expect(pesananSelesai([baris({ qtyKirim: 10, qtyFaktur: 10 })])).toBe(true);
  });
  it("belum selesai kalau masih ada yang belum dikirim atau belum ditagih", () => {
    expect(pesananSelesai([baris({ qtyKirim: 10, qtyFaktur: 4 })])).toBe(false);
    expect(pesananSelesai([baris({ qtyKirim: 6, qtyFaktur: 6 })])).toBe(false);
    expect(pesananSelesai([])).toBe(false);
  });
});

describe("jurnalPengiriman", () => {
  it("modal diakui saat barang keluar, pendapatan belum", () => {
    const l = jurnalPengiriman(1_200_000);
    expect(l).toEqual([
      { code: "5101", debit: 1_200_000, credit: 0 },
      { code: "1301", debit: 0, credit: 1_200_000 },
    ]);
    expect(l.some((x) => x.code === "4101")).toBe(false);
    expect(seimbang(l)).toBe(true);
  });

  it("kiriman tanpa modal (jasa) tidak menghasilkan jurnal", () => {
    expect(jurnalPengiriman(0)).toEqual([]);
  });
});

describe("jurnalFakturJual", () => {
  it("non-PKP: seluruh nilai jadi pendapatan", () => {
    const l = jurnalFakturJual(2_000_000, 0);
    expect(l).toEqual([
      { code: "1201", debit: 2_000_000, credit: 0 },
      { code: "4101", debit: 0, credit: 2_000_000 },
    ]);
    expect(seimbang(l)).toBe(true);
  });

  it("PKP: piutang sebesar DPP + PPN, PPN keluaran dipisah", () => {
    const l = jurnalFakturJual(2_000_000, 220_000);
    expect(l.find((x) => x.code === "1201")?.debit).toBe(2_220_000);
    expect(l.find((x) => x.code === "2201")?.credit).toBe(220_000);
    expect(seimbang(l)).toBe(true);
  });

  it("nol tidak menghasilkan jurnal", () => {
    expect(jurnalFakturJual(0, 0)).toEqual([]);
  });
});

describe("jurnalPenerimaan", () => {
  it("tanpa uang muka: kas masuk, piutang berkurang", () => {
    const l = jurnalPenerimaan("1102", 1_000_000, 0);
    expect(l).toEqual([
      { code: "1102", debit: 1_000_000, credit: 0 },
      { code: "1201", debit: 0, credit: 1_000_000 },
    ]);
    expect(seimbang(l)).toBe(true);
  });

  it("sebagian dari uang muka: kas cuma bertambah sisanya", () => {
    const l = jurnalPenerimaan("1102", 1_000_000, 400_000);
    expect(l.find((x) => x.code === "1102")?.debit).toBe(600_000);
    expect(l.find((x) => x.code === "2103")?.debit).toBe(400_000);
    expect(seimbang(l)).toBe(true);
  });

  it("lunas penuh dari uang muka: kas tidak tersentuh", () => {
    const l = jurnalPenerimaan("1102", 500_000, 500_000);
    expect(l.some((x) => x.code === "1102")).toBe(false);
    expect(seimbang(l)).toBe(true);
  });

  it("uang muka melebihi tagihan tetap dibatasi nominal tagihannya", () => {
    const l = jurnalPenerimaan("1102", 300_000, 900_000);
    expect(l.find((x) => x.code === "2103")?.debit).toBe(300_000);
    expect(seimbang(l)).toBe(true);
  });
});

describe("jurnalUangMukaJual", () => {
  it("DP pelanggan jadi kewajiban, bukan pendapatan", () => {
    const l = jurnalUangMukaJual("1101", 750_000);
    expect(l).toEqual([
      { code: "1101", debit: 750_000, credit: 0 },
      { code: "2103", debit: 0, credit: 750_000 },
    ]);
    expect(l.some((x) => x.code === "4101")).toBe(false);
    expect(seimbang(l)).toBe(true);
  });
});

describe("sisaTagihan", () => {
  it("total dikurangi seluruh penerimaan, tidak negatif", () => {
    expect(sisaTagihan(1_000_000, [{ jumlah: 400_000 }, { jumlah: 100_000 }])).toBe(500_000);
    expect(sisaTagihan(1_000_000, [{ jumlah: 1_500_000 }])).toBe(0);
    expect(sisaTagihan(1_000_000, [])).toBe(1_000_000);
  });
});
