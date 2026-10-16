import { describe, it, expect } from "vitest";
import { quotePosMerchantFees as quote } from "../pos-merchant-fees";

describe("customer merchant fee quotes", () => {
  it("charges only the noncash base in a split", () => {
    expect(quote({ total: 100000, method: "Split", payments: [{ method: "Tunai", amount: 20000 }, { method: "Debit", amount: 80000, feePercent: 2 }] }))
      .toEqual({ total: 101600, feeTotal: 1600, parts: [{ method: "Tunai", amount: 20000 }, { method: "Debit", amount: 81600, fee_percent: 2, fee_amount: 1600 }] });
  });
  it("quotes ordinary fees and retains the old zero-fee shape", () => {
    expect(quote({ total: 100000, method: "QRIS", feePercent: 2 })).toEqual({ total: 102000, feeTotal: 2000, parts: [{ method: "QRIS", amount: 102000, fee_percent: 2, fee_amount: 2000 }] });
    expect(quote({ total: 100000, method: "Tunai" })).toEqual({ total: 100000, feeTotal: 0, parts: [{ method: "Tunai", amount: 100000 }] });
    expect(quote({ total: 0, method: "Debit", feePercent: 2 })).toEqual({ total: 0, feeTotal: 0, parts: [] });
  });
  it("rounds exact half cents like PostgreSQL and retains a positive tiny rate", () => {
    expect(quote({ total: 10000.01, method: "Debit", feePercent: 50 }).feeTotal).toBe(5000.01);
    expect(quote({ total: 0.01, method: "Debit", feePercent: 0.01 }).parts).toEqual([{ method: "Debit", amount: 0.01, fee_percent: 0.01, fee_amount: 0 }]);
  });
  it.each([-1, 101, 0.001, NaN, Infinity])("rejects invalid rate %s", feePercent => {
    expect(() => quote({ total: 100, method: "Debit", feePercent })).toThrow();
  });
  it("rejects cash fees, hidden single fees on splits, invalid allocation and excessive totals", () => {
    expect(() => quote({ total: 100, method: "Tunai", feePercent: 2 })).toThrow();
    expect(() => quote({ total: 100, method: "Split", feePercent: 2, payments: [{ method: "Debit", amount: 100 }] })).toThrow();
    expect(() => quote({ total: 100, method: "Split", payments: [{ method: "Tunai", amount: 100, feePercent: 2 }] })).toThrow();
    expect(() => quote({ total: 100, method: "Split", payments: '[{"method":"Debit","amount":99,"feePercent":2}]' })).toThrow();
    expect(() => quote({ total: 1e12, method: "Debit", feePercent: 1 })).toThrow();
    expect(() => quote({ total: 100.001, method: "Debit" })).toThrow();
  });
});
