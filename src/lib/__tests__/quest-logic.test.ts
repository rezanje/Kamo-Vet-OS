import { describe, expect, it } from "vitest";
import {
  applyStreak, canRedeem, isCompleted, monthlyLeaderboard, msUntilMidnightWib,
  periodKey, saleContribution, streakBonusDue,
} from "../quest-logic";

describe("periodKey (WIB)", () => {
  it("daily = YYYY-MM-DD, monthly = YYYY-MM", () => {
    const now = new Date("2026-07-03T10:00:00+07:00");
    expect(periodKey("daily", now)).toBe("2026-07-03");
    expect(periodKey("monthly", now)).toBe("2026-07");
  });
  it("UTC evening rolls into next WIB day", () => {
    const now = new Date("2026-07-03T18:30:00Z"); // 01:30 WIB besoknya
    expect(periodKey("daily", now)).toBe("2026-07-04");
  });
});

describe("saleContribution", () => {
  const lines = [
    { item_id: "A", category_id: "CAT1", qty: 2 },
    { item_id: "B", category_id: "CAT2", qty: 3 },
  ];
  it("product_qty counts matching item only", () => {
    expect(saleContribution({ target_kind: "product_qty", target_ref_id: "A" }, lines, 99)).toBe(2);
  });
  it("product_qty with null ref counts all items", () => {
    expect(saleContribution({ target_kind: "product_qty", target_ref_id: null }, lines, 99)).toBe(5);
  });
  it("category_qty counts matching category", () => {
    expect(saleContribution({ target_kind: "category_qty", target_ref_id: "CAT2" }, lines, 99)).toBe(3);
  });
  it("total_sales_amount uses sale total", () => {
    expect(saleContribution({ target_kind: "total_sales_amount", target_ref_id: null }, lines, 150000)).toBe(150000);
  });
  it("no match → 0", () => {
    expect(saleContribution({ target_kind: "product_qty", target_ref_id: "Z" }, lines, 99)).toBe(0);
  });
});

describe("isCompleted", () => {
  it("boundary: equal hits target", () => {
    expect(isCompleted(10, 10)).toBe(true);
    expect(isCompleted(9.99, 10)).toBe(false);
  });
});

describe("applyStreak", () => {
  it("consecutive day increments and tracks longest", () => {
    expect(applyStreak("2026-07-02", "2026-07-03", 4, 4)).toEqual({ current: 5, longest: 5, changed: true });
  });
  it("gap resets to 1, keeps longest", () => {
    expect(applyStreak("2026-06-30", "2026-07-03", 7, 9)).toEqual({ current: 1, longest: 9, changed: true });
  });
  it("same day is a no-op", () => {
    expect(applyStreak("2026-07-03", "2026-07-03", 5, 5)).toEqual({ current: 5, longest: 5, changed: false });
  });
  it("first activity ever starts at 1", () => {
    expect(applyStreak(null, "2026-07-03", 0, 0)).toEqual({ current: 1, longest: 1, changed: true });
  });
});

describe("streakBonusDue", () => {
  it("only on multiples of everyDays", () => {
    expect(streakBonusDue(5, 5)).toBe(true);
    expect(streakBonusDue(10, 5)).toBe(true);
    expect(streakBonusDue(4, 5)).toBe(false);
    expect(streakBonusDue(0, 5)).toBe(false);
    expect(streakBonusDue(5, 0)).toBe(false);
  });
});

describe("monthlyLeaderboard", () => {
  const ledger = [
    { staff_id: "s1", points_delta: 50, source_type: "quest_completion", created_at: "2026-07-01T02:00:00Z" },
    { staff_id: "s2", points_delta: 80, source_type: "quest_completion", created_at: "2026-07-02T02:00:00Z" },
    { staff_id: "s1", points_delta: 40, source_type: "quest_completion", created_at: "2026-07-03T02:00:00Z" },
    { staff_id: "s1", points_delta: 999, source_type: "quest_completion", created_at: "2026-06-30T02:00:00Z" }, // bulan lalu
    { staff_id: "s1", points_delta: -100, source_type: "reward_redemption", created_at: "2026-07-02T02:00:00Z" }, // bukan quest
  ];
  it("sums only quest_completion in the month, sorted desc", () => {
    expect(monthlyLeaderboard(ledger, "2026-07")).toEqual([
      { staff_id: "s1", points: 90 },
      { staff_id: "s2", points: 80 },
    ]);
  });
});

describe("canRedeem", () => {
  it("boundary at exact cost", () => {
    expect(canRedeem(500, 500)).toBe(true);
    expect(canRedeem(499, 500)).toBe(false);
  });
});

describe("msUntilMidnightWib", () => {
  it("positive and under 24h", () => {
    const ms = msUntilMidnightWib(new Date());
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(24 * 3600 * 1000);
  });
});
