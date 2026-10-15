import { expect, it } from "vitest";
import { posSubtotal, posNetTotal, roundPosMoney } from "../pos-money";
import { computeTotals } from "../pos-calc";

it("rounds an exact half cent like PostgreSQL numeric", () => {
  const lines = [{ qty: 0.5, harga: 20000.01 }];
  expect(roundPosMoney(posSubtotal(lines))).toBe(10000.01);
  expect(roundPosMoney(computeTotals(lines, 0, 0, 0).total)).toBe(10000.01);
  expect(posNetTotal(posSubtotal(lines), 1000)).toBe(9000.01);
});

it("sums fractional line products before rounding instead of rounding every line", () => {
  const lines = [{ qty: 0.1, harga: 0.1 }, { qty: 0.5, harga: 0.19 }];
  expect(posSubtotal(lines)).toBe(0.105);
  expect(roundPosMoney(computeTotals(lines, 0, 0, 0).total)).toBe(0.11);
});

it("subtracts decimal discounts and points without binary floating residue", () => {
  expect(posNetTotal(0.3, 0.1, 0.2)).toBe(0);
  expect(computeTotals([{ qty: 1, harga: 0.3 }], 0.1, 0.1, 0.1).total).toBe(0);
});
