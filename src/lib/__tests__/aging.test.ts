import { describe, it, expect } from "vitest";
import { agingBucket, agingDays, depreciationPerMonth, monthsElapsed } from "../aging";

describe("aging buckets", () => {
  it("hari yang sama = current", () => {
    expect(agingBucket("2026-07-15", "2026-07-15")).toBe("current");
    expect(agingDays("2026-07-15", "2026-07-15")).toBe(0);
  });
  it("1-30 hari", () => {
    expect(agingBucket("2026-07-01", "2026-07-15")).toBe("d1_30");
    expect(agingBucket("2026-06-15", "2026-07-15")).toBe("d1_30");
  });
  it("31-60 / 61-90 / >90", () => {
    expect(agingBucket("2026-06-01", "2026-07-15")).toBe("d31_60");
    expect(agingBucket("2026-05-01", "2026-07-15")).toBe("d61_90");
    expect(agingBucket("2026-01-01", "2026-07-15")).toBe("d90plus");
  });
  it("tanggal masa depan tidak negatif", () => {
    expect(agingDays("2026-08-01", "2026-07-15")).toBe(0);
  });
});

describe("penyusutan garis lurus", () => {
  it("hitung per bulan", () => {
    // 60jt, sisa 6jt, 5 tahun (60 bln) → 900rb/bln
    expect(depreciationPerMonth(60_000_000, 6_000_000, 60)).toBe(900_000);
  });
  it("umur 0 → 0 (tidak dibagi nol)", () => {
    expect(depreciationPerMonth(10_000_000, 0, 0)).toBe(0);
  });
  it("nilai sisa >= harga → 0", () => {
    expect(depreciationPerMonth(1_000_000, 2_000_000, 12)).toBe(0);
  });
});

describe("monthsElapsed", () => {
  it("bulan perolehan = bulan ke-1", () => {
    expect(monthsElapsed("2026-07-01", "2026-07")).toBe(1);
  });
  it("lintas tahun", () => {
    expect(monthsElapsed("2025-11-15", "2026-07")).toBe(9);
  });
  it("periode sebelum perolehan → < 1", () => {
    expect(monthsElapsed("2026-08-01", "2026-07")).toBeLessThan(1);
  });
});
