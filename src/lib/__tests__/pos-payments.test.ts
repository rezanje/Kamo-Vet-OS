import { describe, expect, it } from "vitest";
import { POS_PAYMENT_METHODS, resolvePosPayments } from "../pos-payments";

const payments = [{ method: "Tunai", amount: 20_000 }, { method: "Transfer", amount: 80_000 }];
const mixed = (overrides: Partial<Parameters<typeof resolvePosPayments>[0]> = {}) => resolvePosPayments({
  total: 100_000, method: "Split", bayar: 20_000, payments, ...overrides,
});

describe("POS mixed payment totals", () => {
  it("allocates a 100000 sale to 20000 cash and 80000 transfer", () => {
    expect(mixed()).toEqual({ parts: payments, method: "Split", bayar: 100_000, kembali: 0 });
  });

  it("returns only the extra cash received while keeping cash allocation unchanged", () => {
    expect(mixed({ bayar: 50_000 })).toEqual({ parts: payments, method: "Split", bayar: 130_000, kembali: 30_000 });
  });

  it("parses the browser's JSON payment field", () => {
    expect(mixed({ payments: JSON.stringify(payments) }).parts).toEqual(payments);
  });

  it("matches exact cents rather than the binary floating point sum", () => {
    const parts = [{ method: "Tunai", amount: 0.1 }, { method: "Transfer", amount: 0.2 }];
    expect(mixed({ total: 0.3, payments: parts, bayar: 0.3 })).toEqual({ parts, method: "Split", bayar: 0.5, kembali: 0.2 });
  });

  it.each([
    { payments: [{ method: "Tunai", amount: 100_000.001 }], total: 100_000.001, bayar: 100_000.001 },
    { payments: [{ method: "Tunai", amount: 100_000 }], total: 100_000, bayar: 100_000.001 },
  ])("rejects money with more than two decimal places", overrides => {
    expect(() => mixed(overrides)).toThrow();
  });

  it.each([99_999, 100_001])("rejects allocations totaling %s rather than the exact sale total", sum => {
    expect(() => mixed({ payments: [{ method: "Transfer", amount: sum }] })).toThrow(/sama dengan total/i);
  });

  it("rejects cash received below its allocation", () => {
    expect(() => mixed({ bayar: 19_999 })).toThrow(/tunai.*kurang/i);
  });

  it("accepts a combination without cash and does not create change", () => {
    const parts = [{ method: "Transfer", amount: 80_000 }, { method: "QRIS", amount: 20_000 }];
    expect(mixed({ payments: parts, bayar: 0 })).toEqual({ parts, method: "Split", bayar: 100_000, kembali: 0 });
  });

  it("rejects cash received for a combination that has no cash method", () => {
    expect(() => mixed({ payments: [{ method: "Transfer", amount: 100_000 }], bayar: 1 })).toThrow(/tunai/i);
  });

  it.each([
    ["unparseable JSON", "bad-json"],
    ["object instead of list", {}],
    ["empty list", []],
    ["more than six parts", Array.from({ length: 7 }, () => ({ method: "Tunai", amount: 1 }))],
    ["repeated method", [{ method: "Tunai", amount: 20_000 }, { method: "Tunai", amount: 80_000 }]],
    ["unknown method", [{ method: "Lainnya", amount: 100_000 }]],
    ["zero allocation", [{ method: "Tunai", amount: 0 }, { method: "Transfer", amount: 100_000 }]],
    ["negative allocation", [{ method: "Tunai", amount: -1 }, { method: "Transfer", amount: 100_001 }]],
    ["nonfinite allocation", [{ method: "Tunai", amount: Infinity }]],
    ["string allocation", [{ method: "Tunai", amount: "100000" }]],
  ])("rejects %s", (_reason, parts) => {
    expect(() => mixed({ payments: parts })).toThrow();
  });

  it.each([NaN, Infinity, -1])("rejects invalid cash tender %s", bayar => {
    expect(() => mixed({ bayar })).toThrow();
  });

  it("rejects split allocation for a zero-total sale", () => {
    expect(() => mixed({ total: 0, payments: [{ method: "Tunai", amount: 1 }] })).toThrow();
  });
});

describe("single POS payments", () => {
  it("keeps existing cash tender and change behavior", () => {
    expect(resolvePosPayments({ total: 100_000, method: "Tunai", bayar: 150_000 })).toEqual({
      parts: [{ method: "Tunai", amount: 100_000 }], method: "Tunai", bayar: 150_000, kembali: 50_000,
    });
    expect(() => resolvePosPayments({ total: 100_000, method: "Tunai", bayar: 99_999 })).toThrow(/kurang/i);
  });

  it("calculates single cash change in exact cents", () => {
    expect(resolvePosPayments({ total: 0.1, method: "Tunai", bayar: 0.3 }).kembali).toBe(0.2);
  });

  it.each(POS_PAYMENT_METHODS.filter(method => method !== "Tunai"))("records %s once with no change even when a previous cash tender remains", method => {
    expect(resolvePosPayments({ total: 100_000, method, bayar: 150_000, payments: "[]" })).toEqual({
      parts: [{ method, amount: 100_000 }], method, bayar: 100_000, kembali: 0,
    });
  });

  it("retains zero-total single sales without creating zero-value payment rows", () => {
    expect(resolvePosPayments({ total: 0, method: "Tunai", bayar: 0 })).toEqual({ parts: [], method: "Tunai", bayar: 0, kembali: 0 });
  });

  it("rejects conflicting split rows on a single-method submission", () => {
    expect(() => resolvePosPayments({ total: 100_000, method: "Transfer", bayar: 0, payments })).toThrow();
  });

  it.each([NaN, Infinity, -1])("rejects invalid sale total %s", total => {
    expect(() => resolvePosPayments({ total, method: "Transfer", bayar: 0 })).toThrow();
  });

  it("rejects an unsupported method", () => {
    expect(() => resolvePosPayments({ total: 100_000, method: "Other", bayar: 0 })).toThrow();
  });
});
