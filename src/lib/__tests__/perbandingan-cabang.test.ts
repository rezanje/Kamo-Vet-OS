import { describe, expect, it } from "vitest";
import {
  nilaiStokPadaTanggal,
  pertumbuhan,
  rekapPerCabang,
  rentangBulanLalu,
  samaTanggalBulanLalu,
  unitGudang,
  type DokumenUnit,
} from "../perbandingan-cabang";

describe("tanggal yang sama bulan lalu", () => {
  it.each([
    ["2026-11-15", "2026-10-15"],
    ["2026-11-01", "2026-10-01"],
    ["2026-01-10", "2025-12-10"],
    ["2026-03-29", "2026-02-28"],
    ["2026-03-31", "2026-02-28"],
    ["2026-11-30", "2026-10-31"],
    ["2026-10-31", "2026-09-30"],
    ["2028-03-31", "2028-02-29"],
  ])("%s → %s", (input, expected) => {
    expect(samaTanggalBulanLalu(input)).toBe(expected);
  });

  it("bulan berjalan 1–15 Nov dibanding 1–15 Okt; sebulan penuh dibanding sebulan penuh", () => {
    expect(rentangBulanLalu("2026-11-01", "2026-11-15")).toEqual({ from: "2026-10-01", to: "2026-10-15" });
    expect(rentangBulanLalu("2026-11-01", "2026-11-30")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("menolak tanggal tidak sah", () => {
    expect(() => samaTanggalBulanLalu("2026-02-30")).toThrow();
    expect(() => samaTanggalBulanLalu("15-11-2026")).toThrow();
  });
});

describe("pertumbuhan", () => {
  it("naik, turun, dan tanpa pembanding", () => {
    expect(pertumbuhan(120, 100)).toBeCloseTo(20);
    expect(pertumbuhan(80, 100)).toBeCloseTo(-20);
    expect(pertumbuhan(50, 0)).toBeNull();
    expect(pertumbuhan(null, 100)).toBeNull();
    expect(pertumbuhan(100, null)).toBeNull();
  });
});

describe("rekap per cabang", () => {
  const doc = (unit: DokumenUnit["unit"], documentId: string, branchId: string, customerId: string | null, net: number): DokumenUnit =>
    ({ unit, documentId, branchId, customerId, net });

  it("rata-rata, customer unik, transaksi per unit, dan total lintas cabang", () => {
    const result = rekapPerCabang(["b1", "b2"], [
      doc("petshop", "s1", "b1", "c1", 100), doc("petshop", "s2", "b1", "c1", 50), doc("petshop", "s3", "b1", null, 30),
      doc("petshop", "s4", "b2", "c1", 200),
      doc("klinik", "i1", "b2", "c9", 500),
      doc("petshop", "luar", "b3", "c7", 999),
    ], new Map([["b1", 3], ["b2", 1.5]]));
    expect(result.get("b1")).toEqual({
      petshop: { transaksi: 3, omzet: 180, rataRata: 60, customer: 1 },
      klinik: { transaksi: 0, omzet: 0, rataRata: null, customer: 0 },
      grooming: 3,
    });
    expect(result.get("b2")?.klinik).toEqual({ transaksi: 1, omzet: 500, rataRata: 500, customer: 1 });
    // c1 belanja di dua cabang: tetap satu customer di total. Cabang di luar cakupan diabaikan.
    expect(result.get("*")).toEqual({
      petshop: { transaksi: 4, omzet: 380, rataRata: 95, customer: 1 },
      klinik: { transaksi: 1, omzet: 500, rataRata: 500, customer: 1 },
      grooming: 4.5,
    });
  });
});

describe("nilai stok per cabang", () => {
  it("gudang VET = klinik, RETAIL/ONLINE = petshop, lainnya tidak dihitung", () => {
    expect(unitGudang("VET")).toBe("klinik");
    expect(unitGudang("RETAIL")).toBe("petshop");
    expect(unitGudang("ONLINE")).toBe("petshop");
    expect(unitGudang("DC")).toBeNull();
    expect(unitGudang("EXPIRED")).toBeNull();
    expect(unitGudang("TRANSIT")).toBeNull();
  });

  it("dihitung mundur: nilai sekarang dikurangi mutasi sesudah tanggal, termasuk penyesuaian nilai", () => {
    const warehouses = [
      { id: "r1", branchId: "b1", type: "RETAIL" }, { id: "o1", branchId: "b1", type: "ONLINE" },
      { id: "v1", branchId: "b1", type: "VET" }, { id: "d1", branchId: "b1", type: "DC" },
      { id: "r2", branchId: "b2", type: "RETAIL" },
    ];
    const nilaiSekarang = new Map([["r1", 1000], ["o1", 200], ["v1", 700], ["d1", 99999], ["r2", 300]]);
    const mutasi = [
      { warehouseId: "r1", tanggal: "2026-11-10", qty: -2, unitCost: 100, valuationAdjustment: 0 },
      { warehouseId: "r1", tanggal: "2026-10-20", qty: 5, unitCost: 100, valuationAdjustment: 0 },
      { warehouseId: "v1", tanggal: "2026-10-16", qty: 0, unitCost: 0, valuationAdjustment: 40 },
      { warehouseId: "v1", tanggal: "2026-10-15", qty: 3, unitCost: 100, valuationAdjustment: 0 },
      { warehouseId: "r2", tanggal: "2026-11-01", qty: 1, unitCost: 300, valuationAdjustment: 0 },
    ];
    const lalu = nilaiStokPadaTanggal({ tanggal: "2026-10-15", warehouses, nilaiSekarang, mutasi, branchIds: ["b1", "b2"] });
    expect(lalu.get("b1")).toEqual({ petshop: 1000 + 200 - 500 + 200, klinik: 700 - 40 });
    expect(lalu.get("b2")).toEqual({ petshop: 0, klinik: 0 });
    expect(lalu.get("*")).toEqual({ petshop: 900, klinik: 660 });
    const kini = nilaiStokPadaTanggal({ tanggal: "2026-11-15", warehouses, nilaiSekarang, mutasi, branchIds: ["b1"] });
    expect(kini.get("b1")).toEqual({ petshop: 1200, klinik: 700 });
    expect(kini.has("b2")).toBe(false);
  });
});
