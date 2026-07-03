import { describe, expect, it } from "vitest";
import { cashVariance, expectedCash, invoiceCashRows, methodBreakdown, PAYMENT_METHODS } from "../shift-calc";

describe("methodBreakdown", () => {
  it("groups totals per payment method with all methods present", () => {
    const b = methodBreakdown([
      { total: 10000, metode_bayar: "Tunai" },
      { total: 5000, metode_bayar: "Tunai" },
      { total: 20000, metode_bayar: "QRIS" },
    ]);
    expect(b["Tunai"]).toBe(15000);
    expect(b["QRIS"]).toBe(20000);
    expect(b["Debit"]).toBe(0);
    for (const m of PAYMENT_METHODS) expect(b).toHaveProperty(m);
  });

  it("keeps unknown methods instead of dropping them", () => {
    const b = methodBreakdown([{ total: 7000, metode_bayar: "Transfer" }]);
    expect(b["Transfer"]).toBe(7000);
  });
});

describe("expectedCash", () => {
  it("counts opening balance plus cash only", () => {
    expect(expectedCash(100000, { Tunai: 50000, QRIS: 999999 })).toBe(150000);
  });
  it("handles missing Tunai key", () => {
    expect(expectedCash(100000, {})).toBe(100000);
  });
});

describe("invoiceCashRows", () => {
  it("maps Lunas→total, DP→dp_amount, Belum Lunas→0", () => {
    const rows = invoiceCashRows([
      { total: 100000, dp_amount: 0, paid_status: "Lunas", metode_bayar: "Tunai" },
      { total: 200000, dp_amount: 50000, paid_status: "DP", metode_bayar: "Tunai" },
      { total: 300000, dp_amount: 0, paid_status: "Belum Lunas", metode_bayar: "QRIS" },
    ]);
    expect(rows.map((r) => r.total)).toEqual([100000, 50000, 0]);
    expect(rows[2].metode_bayar).toBe("QRIS");
  });
});

describe("cashVariance", () => {
  it("negative when short, positive when over, zero when exact", () => {
    expect(cashVariance(90000, 100000)).toBe(-10000);
    expect(cashVariance(110000, 100000)).toBe(10000);
    expect(cashVariance(100000, 100000)).toBe(0);
  });
});
