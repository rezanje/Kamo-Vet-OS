import { describe, expect, it } from "vitest";
import { parseRecurringOccurrences } from "../recurring";

describe("optional monthly recurring repeat limit", () => {
  it("keeps missing or blank count unlimited", () => {
    expect(parseRecurringOccurrences(null)).toBeNull();
    expect(parseRecurringOccurrences("  ")).toBeNull();
  });
  it("accepts a positive whole count", () => {
    expect(parseRecurringOccurrences("12")).toBe(12);
    expect(parseRecurringOccurrences("1")).toBe(1);
  });
  it.each(["0", "-1", "1.5", "NaN", "Infinity", "1e2", "2147483648", "abc"])("rejects %s server-side", (value) => {
    expect(() => parseRecurringOccurrences(value)).toThrow("Jumlah pengulangan");
  });
});
