import { describe, expect, it } from "vitest";
import {
  buildPeriod,
  canAccessOperationSales,
  classifyCustomers,
  growthPercent,
  outstandingPoQty,
  rankMovement,
  resolveSalesTarget,
  salesMetrics,
  stockCoverage,
  stockValue,
  supplierPerformance,
  targetAchievement,
} from "../operation-sales";

describe("operation sales metrics", () => {
  it("membatasi rollout ke OWNER/ADMIN kecuali peran dibuka eksplisit", () => {
    expect(canAccessOperationSales("OWNER", undefined)).toBe(true);
    expect(canAccessOperationSales("ADMIN", "")).toBe(true);
    expect(canAccessOperationSales("STAFF", undefined)).toBe(false);
    expect(canAccessOperationSales("STAFF", "FINANCE, STAFF")).toBe(true);
  });

  it("MTD membandingkan hari setara bulan sebelumnya", () => {
    expect(buildPeriod({ preset: "mtd", now: "2026-08-31" })).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
      previousFrom: "2026-07-01",
      previousTo: "2026-07-31",
    });
  });

  it("menghitung net sales, transaksi, ATV, UPT, dan margin dari transaksi valid", () => {
    const result = salesMetrics([
      { saleId: "s1", qty: 2, net: 100_000, cost: 60_000, status: "paid" },
      { saleId: "s1", qty: 1, net: 50_000, cost: 20_000, status: "paid" },
      { saleId: "s2", qty: 1, net: 90_000, cost: 40_000, status: "void" },
    ]);
    expect(result).toEqual({
      sales: 150_000,
      transactions: 1,
      units: 3,
      atv: 150_000,
      upt: 3,
      grossMargin: 70_000,
    });
  });

  it("mengembalikan null saat pembanding atau target tidak tersedia", () => {
    expect(growthPercent(100, null)).toBeNull();
    expect(growthPercent(100, 0)).toBeNull();
    expect(targetAchievement(100, null)).toBeNull();
    expect(targetAchievement(100, 0)).toBeNull();
  });

  it("memilih target perusahaan sebelum menjumlah target cabang", () => {
    expect(resolveSalesTarget([
      { period: "2026-08", amount: 900, branchId: null, employeeId: null, categoryId: null },
      { period: "2026-08", amount: 500, branchId: "b1", employeeId: null, categoryId: null },
      { period: "2026-08", amount: 600, branchId: "b2", employeeId: null, categoryId: null },
      { period: "2026-08", amount: 999, branchId: "b1", employeeId: "e1", categoryId: null },
      { period: "2026-08", amount: 888, branchId: "b1", employeeId: null, categoryId: "c1" },
    ], ["b1", "b2"], "2026-08")).toBe(900);

    expect(resolveSalesTarget([
      { period: "2026-08", amount: 500, branchId: "b1", employeeId: null, categoryId: null },
      { period: "2026-08", amount: 600, branchId: "b2", employeeId: null, categoryId: null },
      { period: "2026-08", amount: 999, branchId: "b1", employeeId: "e1", categoryId: null },
    ], ["b1"], "2026-08")).toBe(500);
  });

  it("mengklasifikasikan pelanggan baru, repeat, aktif, dorman, dan spending", () => {
    const result = classifyCustomers([
      { customerId: "new", saleId: "n1", date: "2026-08-03", net: 100, status: "paid" },
      { customerId: "repeat", saleId: "r1", date: "2026-01-01", net: 50, status: "paid" },
      { customerId: "repeat", saleId: "r2", date: "2026-08-04", net: 200, status: "paid" },
      { customerId: "active", saleId: "a1", date: "2026-07-01", net: 75, status: "paid" },
      { customerId: "dormant", saleId: "d1", date: "2026-01-01", net: 300, status: "paid" },
      { customerId: "voided", saleId: "v1", date: "2026-08-05", net: 999, status: "void" },
    ], { from: "2026-08-01", to: "2026-08-31" }, 90, "2026-08-31");

    expect(result.newCustomers).toBe(1);
    expect(result.repeatCustomers).toBe(1);
    expect(result.activeCustomers).toBe(3);
    expect(result.dormantCustomers).toBe(1);
    expect(result.spending).toEqual({ new: 100, repeat: 200 });
  });

  it("meranking fast-moving dari 20 persen SKU dan slow-moving dari stok positif", () => {
    const result = rankMovement([
      { itemId: "a", soldQty: 100, stockQty: 0, lastSoldAt: "2026-08-30" },
      { itemId: "b", soldQty: 80, stockQty: 10, lastSoldAt: "2026-08-20" },
      { itemId: "c", soldQty: 60, stockQty: 10, lastSoldAt: "2026-01-01" },
      { itemId: "d", soldQty: 0, stockQty: 5, lastSoldAt: null },
      { itemId: "e", soldQty: 20, stockQty: 0, lastSoldAt: "2026-08-01" },
    ], "2026-08-31", 90, 0.2);

    expect(result.fast.map((row) => row.itemId)).toEqual(["a"]);
    expect(result.slow.map((row) => row.itemId)).toEqual(["c", "d"]);
  });

  it("menghitung nilai stok, coverage, dan outstanding PO tanpa memalsukan nol", () => {
    expect(stockValue([
      { qtyLeft: 2, unitCost: 100 },
      { qtyLeft: 3, unitCost: 50 },
    ])).toBe(350);
    expect(stockCoverage(45, 90)).toBe(45);
    expect(stockCoverage(45, 0)).toBeNull();
    expect(outstandingPoQty([
      { orderedQty: 10, receivedQty: 7 },
      { orderedQty: 4, receivedQty: 8 },
    ])).toBe(3);
  });

  it("menghitung performa pemasok dari penerimaan nyata tanpa metrik janji kirim", () => {
    expect(supplierPerformance([
      { supplierId: "s1", supplierName: "A", purchased: 1_000, orderedQty: 10, receivedQty: 8, returned: 100, poDate: "2026-08-01", receivedDate: "2026-08-04" },
      { supplierId: "s1", supplierName: "A", purchased: 500, orderedQty: 5, receivedQty: 5, returned: 0, poDate: "2026-08-10", receivedDate: "2026-08-12" },
    ])).toEqual([{
      supplierId: "s1",
      supplierName: "A",
      purchased: 1_500,
      fillRate: 13 / 15,
      returned: 100,
      averageLeadDays: 2.5,
    }]);
  });
});
