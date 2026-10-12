import { describe, expect, it } from "vitest";
import { allocateDemoIncentive, quoteDemoPayments } from "../clinic-demo-policy";

const policy = { id: "demo-v1", name: "DEMO", incentivePercent: 5, feeBearer: "customer" as const,
  feeRates: { Tunai: 0, Transfer: 100, QRIS: 0 }, adminRevenueCode: "4303", adminExpenseCode: "5501" };

describe("DEMO payment quote", () => {
  it("adds 1 percent to only the transfer portion without recursive fees", () => {
    const q = quoteDemoPayments(policy, [{ method: "Tunai", amount: 62500 }, { method: "Transfer", amount: 62500 }]);
    expect(q.customerFee).toBe(625);
    expect(q.companyFee).toBe(0);
    expect(q.parts.map(p => [p.amount, p.fee, p.gross, p.net])).toEqual([[62500, 0, 62500, 62500], [62500, 625, 63125, 63125]]);
  });
  it("keeps the customer bill unchanged for a company-borne fee", () => {
    const q = quoteDemoPayments({ ...policy, feeBearer: "company" }, [{ method: "Transfer", amount: 125000 }]);
    expect(q.customerFee).toBe(0); expect(q.companyFee).toBe(1250);
    expect(q.parts[0].gross).toBe(125000); expect(q.parts[0].net).toBe(123750);
  });
  it("rounds per part and supports zero-rate methods", () => {
    expect(quoteDemoPayments(policy, [{ method: "Transfer", amount: 155 }]).customerFee).toBe(2);
    expect(quoteDemoPayments(policy, [{ method: "QRIS", amount: 1000 }]).customerFee).toBe(0);
  });
  it.each([0, -1, NaN, Infinity, 1.5])("rejects invalid principal %s", amount => {
    expect(() => quoteDemoPayments(policy, [{ method: "Tunai", amount }])).toThrow();
  });
  it("rejects unknown methods and invalid rates", () => {
    expect(() => quoteDemoPayments(policy, [{ method: "fake", amount: 100 }])).toThrow();
    expect(() => quoteDemoPayments({ ...policy, feeRates: { Transfer: -1 } }, [{ method: "Transfer", amount: 100 }])).toThrow();
  });
});

describe("one shared incentive pool", () => {
  it("splits a 2500 pool exactly across three people", () => {
    expect(allocateDemoIncentive(2500, ["c", "a", "b"])).toEqual([
      { employeeId: "a", amount: 834 }, { employeeId: "b", amount: 833 }, { employeeId: "c", amount: 833 },
    ]);
  });
  it("deduplicates recipients without multiplying the pool", () => {
    expect(allocateDemoIncentive(50000, ["a", "a", "b"])).toEqual([{ employeeId: "a", amount: 25000 }, { employeeId: "b", amount: 25000 }]);
  });
  it("handles zero and rejects a positive pool without recipients", () => {
    expect(allocateDemoIncentive(0, [])).toEqual([]);
    expect(() => allocateDemoIncentive(100, [])).toThrow();
    expect(() => allocateDemoIncentive(-1, ["a"])).toThrow();
  });
});
