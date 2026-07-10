import { describe, expect, it } from "vitest";
import { computeTier, type TierThresholds } from "../customer-tier";

const T: TierThresholds = { bronze_min: 1_000_000, silver_min: 5_000_000, gold_min: 15_000_000, platinum_min: 50_000_000 };

describe("computeTier", () => {
  it("below bronze is New", () => {
    expect(computeTier(0, T)).toBe("New");
    expect(computeTier(999_999, T)).toBe("New");
  });
  it("exactly at a threshold takes that tier", () => {
    expect(computeTier(1_000_000, T)).toBe("Bronze");
    expect(computeTier(5_000_000, T)).toBe("Silver");
    expect(computeTier(15_000_000, T)).toBe("Gold");
    expect(computeTier(50_000_000, T)).toBe("Platinum");
  });
  it("between thresholds takes the lower tier", () => {
    expect(computeTier(4_999_999, T)).toBe("Bronze");
    expect(computeTier(49_999_999, T)).toBe("Gold");
  });
  it("above platinum stays Platinum", () => {
    expect(computeTier(999_000_000, T)).toBe("Platinum");
  });
});
