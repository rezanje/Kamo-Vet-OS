import { describe, it, expect } from "vitest";
import { susunKartuStok, labelSource, labelMutasi, nilaiSatuanKartu, type Mutasi } from "./kartu-stok";

const m = (qty: number, source = "sale"): Mutasi => ({
  tanggal: "2026-07-01", qty, unit_cost: 0, source, source_ref: null, gudang: "WH",
});

describe("susunKartuStok", () => {
  it("saldo berjalan naik-turun mengikuti urutan mutasi", () => {
    const rows = susunKartuStok(10, [m(5, "purchase"), m(-3), m(-2)]);
    expect(rows.map((r) => r.saldo)).toEqual([15, 12, 10]);
  });

  it("memisah masuk & keluar, keluar selalu positif", () => {
    const [masuk, keluar] = susunKartuStok(0, [m(4, "purchase"), m(-4)]);
    expect([masuk.masuk, masuk.keluar]).toEqual([4, 0]);
    expect([keluar.masuk, keluar.keluar]).toEqual([0, 4]);
  });

  it("saldo boleh minus — stok minus harus kelihatan, bukan disembunyikan", () => {
    expect(susunKartuStok(1, [m(-3)])[0].saldo).toBe(-2);
  });

  it("tanpa mutasi hasilnya kosong (saldo awal ditampilkan terpisah)", () => {
    expect(susunKartuStok(7, [])).toEqual([]);
  });

  it("source tak dikenal ditampilkan apa adanya, bukan jadi kosong", () => {
    expect(labelSource("sale")).toBe("Faktur Penjualan");
    expect(labelSource("entah-apa")).toBe("entah-apa");
  });
});

describe("labelMutasi / nilaiSatuanKartu (SO-SURPLUS-HPP)", () => {
  it("opname menyebut arahnya; sumber lain tidak berubah", () => {
    expect(labelMutasi("opname", 4)).toBe("Stok Opname — selisih lebih (+)");
    expect(labelMutasi("opname", -4)).toBe("Stok Opname — selisih kurang (−)");
    expect(labelMutasi("penyesuaian", 1)).toContain("lebih (+)");
    expect(labelMutasi("stock-correction", -1)).toContain("kurang (−)");
    expect(labelMutasi("sale", -1)).toBe("Faktur Penjualan");
    expect(labelMutasi("opname", 0)).toBe("Stok Opname");
    expect(labelMutasi("entah", 3)).toBe("entah");
  });
  it("nilai satuan: HPP tampil; masuk opname Rp0 ditandai; keluar dan sumber lain tetap tanda hubung", () => {
    expect(nilaiSatuanKartu({ source: "opname", qty: 4, unit_cost: 150.4 })).toEqual({ teks: "150", tanpaHarga: false });
    expect(nilaiSatuanKartu({ source: "opname", qty: 4, unit_cost: 0 })).toEqual({ teks: "Rp 0 (belum ada harga)", tanpaHarga: true });
    expect(nilaiSatuanKartu({ source: "penyesuaian", qty: 2, unit_cost: 0 }).tanpaHarga).toBe(true);
    expect(nilaiSatuanKartu({ source: "opname", qty: -2, unit_cost: 0 })).toEqual({ teks: "—", tanpaHarga: false });
    expect(nilaiSatuanKartu({ source: "sale", qty: 2, unit_cost: 0 })).toEqual({ teks: "—", tanpaHarga: false });
  });
});

