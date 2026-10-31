import { describe, expect, it } from "vitest";
import { StockDecimal, lineRupiahRounding, stockDecimalPreview } from "../initial-stock-decimal";
import { DEFAULT_VALUATION_POLICY, VALUATION_POLICY_OPTIONS, valuationPolicyLabel } from "../initial-stock-valuation-policy";

// Synthetic fixture: 60 Accurate-style lines with fractional cents and sub-cent HPP.
const costs = ["3333.3333", "1234.5678", "99.995", "0.004999", "12500.125", "7.777777", "15000.5", "2499.49", "0.5", "1.4999"];
const qtys = ["3", "7", "11", "2", "1", "4", "6", "9", "1", "1"];
const fixture = Array.from({ length: 60 }, (_, index) => {
  const qty = qtys[index % qtys.length];
  const unitCost = new StockDecimal(costs[index % costs.length]).plus(new StockDecimal(index).div(1000)).toFixed();
  return { status: "valid", baseQty: Number(qty), baseQtyExact: qty, value: 0, sourceValues: [{ qty, unit_cost: unitCost }] };
});
const exactSource = fixture.reduce((sum, row) => sum.plus(new StockDecimal(row.sourceValues[0].qty).times(row.sourceValues[0].unit_cost)), new StockDecimal(0));
const sumOfRoundedLines = fixture.reduce((sum, row) => sum.plus(new StockDecimal(row.sourceValues[0].qty).times(row.sourceValues[0].unit_cost).toDecimalPlaces(0, StockDecimal.ROUND_HALF_UP)), new StockDecimal(0));

describe("per-line whole-rupiah rounding (M04/M01, owner decision 29 Oct)", () => {
  it("rounds every line to whole rupiah and records the total difference against the source control total", () => {
    const result = lineRupiahRounding(fixture);
    expect(exactSource.decimalPlaces()).toBeGreaterThan(2);
    expect(result.lines).toBe(60);
    expect(result.source.eq(exactSource)).toBe(true);
    expect(result.rounded.isInteger()).toBe(true);
    expect(result.rounded.eq(sumOfRoundedLines)).toBe(true);
    expect(result.delta.eq(sumOfRoundedLines.minus(exactSource))).toBe(true);
    // Not the same as rounding only the batch total: that is exactly why the difference is shown.
    expect(result.rounded.eq(exactSource.toDecimalPlaces(0))).toBe(false);
    // Each line moves by at most half a rupiah, so the total difference is bounded by lines / 2.
    expect(result.delta.abs().lte(new StockDecimal(result.lines).div(2))).toBe(true);
  });

  it("rounds a half rupiah up and keeps tiny lines at zero", () => {
    const line = (qty: string, unit_cost: string) => ({ status: "valid", baseQty: Number(qty), value: 0, sourceValues: [{ qty, unit_cost }] });
    expect(lineRupiahRounding([line("1", "0.5")]).rounded.toFixed()).toBe("1");
    expect(lineRupiahRounding([line("1", "1.4999")]).rounded.toFixed()).toBe("1");
    expect(lineRupiahRounding([line("2", "0.004999")]).rounded.toFixed()).toBe("0");
    expect(lineRupiahRounding([line("3", "3333.3333")]).rounded.toFixed()).toBe("10000");
  });

  it("counts a saved line carried by two cent-rate layers once, and ignores skipped/rejected rows", () => {
    const saved = [
      // Rp10.000 / 3 has no finite rate: 1 unit @ 3333.34 + 2 units @ 3333.33, both repeating the line's source evidence.
      { status: "valid", baseQty: 1, baseQtyExact: "1", value: 3333.34, linePart: 1, sourceValues: [{ qty: "3", unit_cost: "3333.3333" }] },
      { status: "valid", baseQty: 2, baseQtyExact: "2", value: 6666.66, linePart: 2, sourceValues: [{ qty: "3", unit_cost: "3333.3333" }] },
      { status: "skipped", baseQty: 5, value: 5, sourceValues: [{ qty: "5", unit_cost: "1.5" }] },
      { status: "rejected", baseQty: 5, value: 5, sourceValues: [{ qty: "5", unit_cost: "1.5" }] },
    ];
    const preview = stockDecimalPreview(saved);
    expect(preview).toMatchObject({ quantity: "3", source_value: "9999.9999", line_rounded_value: "10000", line_rounding_delta: "0.0001", lines: 1, rounded_value: "10000.00" });
  });

  it("exposes the full fixture through the import preview", () => {
    const preview = stockDecimalPreview(fixture);
    expect(preview.line_rounded_value).toBe(sumOfRoundedLines.toFixed(0));
    expect(preview.line_rounding_delta).toBe(sumOfRoundedLines.minus(exactSource).toFixed());
    expect(preview.source_value).toBe(exactSource.toFixed());
  });

  it("makes the owner decision the default while keeping every choice explicit", () => {
    expect(DEFAULT_VALUATION_POLICY).toBe("ROUND_LINE_RUPIAH_V1");
    expect(VALUATION_POLICY_OPTIONS[0].value).toBe(DEFAULT_VALUATION_POLICY);
    expect(VALUATION_POLICY_OPTIONS.map(option => option.value)).toEqual(["ROUND_LINE_RUPIAH_V1", "HALF_UP_BATCH_V1", "STRICT"]);
    expect(valuationPolicyLabel("ROUND_LINE_RUPIAH_V1")).toBe("Bulatkan nilai tiap baris ke rupiah penuh");
    expect(valuationPolicyLabel("UNKNOWN")).toBe("UNKNOWN");
  });
});
