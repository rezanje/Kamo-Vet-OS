import { describe, expect, it } from "vitest";
import {
  firstRecurringSourcePeriod,
  recurringSourceBounds,
  recurringSourceDue,
  recurringSourcePeriodIndex,
  recurringSourceProgress,
  recurringSourceWindow,
} from "../recurring-source";

const sourceDate = "2025-10-17";
const config = { first_period: "2025-11", last_period: "2026-10", count: 12, day: 25 };

describe("monthly journal-source recurrence", () => {
  it("starts after the source month or at the current WIB month, whichever is later", () => {
    expect(firstRecurringSourcePeriod(sourceDate, new Date("2025-10-31T17:30:00.000Z"))).toBe("2025-11");
    expect(firstRecurringSourcePeriod(sourceDate, new Date("2026-02-01T00:00:00.000Z"))).toBe("2026-02");
  });

  it("derives a finite inclusive end and rejects a count/end mismatch", () => {
    expect(recurringSourceBounds("2025-11", 12, null)).toEqual({ count: 12, last_period: "2026-10" });
    expect(recurringSourceBounds("2025-11", null, "2026-10")).toEqual({ count: 12, last_period: "2026-10" });
    expect(() => recurringSourceBounds("2025-11", 12, "2026-11")).toThrow("tidak cocok");
    expect(() => recurringSourceBounds("9999-12", 2, null)).toThrow("rentang kalender");
  });

  it("uses the selected WIB posting day to determine whether a month is due", () => {
    expect(recurringSourceDue("2026-07", 25, new Date("2026-07-24T16:59:00.000Z"))).toBe(false);
    expect(recurringSourceDue("2026-07", 25, new Date("2026-07-24T17:00:00.000Z"))).toBe(true);
    expect(recurringSourceDue("2026-08", 1, new Date("2026-07-25T04:00:00.000Z"))).toBe(false);
  });

  it("shows at most 24 virtual periods and marks only matching receipts as executed", () => {
    const periods = recurringSourceWindow({ first_period: "2025-11", count: 30 }, [
      { schedule_id: "schedule-1", period: "2025-11", journal_id: "entry-1", receipt: { schedule_id: "schedule-1", period: "2025-11", entry_id: "entry-1", no_jurnal: "JU-FIKTIF-1", posted: true } },
      { schedule_id: "schedule-1", period: "2025-12", journal_id: "entry-wrong", receipt: { schedule_id: "schedule-1", period: "2025-12", entry_id: "other", no_jurnal: "JU-FIKTIF-2", posted: true } },
    ], 0);
    expect(periods).toHaveLength(24);
    expect(periods[0]).toMatchObject({ period: "2025-11", state: "executed", journal_id: "entry-1" });
    expect(periods[1]).toMatchObject({ period: "2025-12", state: "review" });
    expect(periods[2]).toMatchObject({ period: "2026-01", state: "pending" });
    expect(recurringSourceWindow({ first_period: "2025-11", count: 30 }, [], 1)[0].period).toBe("2027-11");
    expect(recurringSourceWindow({ first_period: "2025-11", count: 30 }, [], 2)).toEqual([]);
  });

  it("marks a receipt for a different schedule or without its journal number as review", () => {
    expect(recurringSourceWindow({ first_period: "2025-11", count: 1 }, [
      { schedule_id: "schedule-1", period: "2025-11", journal_id: "entry-1", receipt: { schedule_id: "schedule-2", period: "2025-11", entry_id: "entry-1", no_jurnal: "JU-FIKTIF-1", posted: true } },
    ])[0].state).toBe("review");
    expect(recurringSourceWindow({ first_period: "2025-11", count: 1 }, [
      { schedule_id: "schedule-1", period: "2025-11", journal_id: "entry-1", receipt: { schedule_id: "schedule-1", period: "2025-11", entry_id: "entry-1", posted: true } },
    ])[0].state).toBe("review");
  });

  it("flags progress outside the confirmed finite schedule", () => {
    expect(recurringSourceProgress(config, null)).toBe(0);
    expect(recurringSourceProgress(config, "2025-11")).toBe(1);
    expect(recurringSourceProgress(config, "2026-11")).toBeNull();
  });

  it("rejects noncanonical periods and out-of-range years", () => {
    expect(recurringSourcePeriodIndex("2026-10")).toBe(2025 * 12 + 9);
    expect(recurringSourcePeriodIndex("2026-13")).toBeNull();
    expect(() => firstRecurringSourcePeriod("0000-01-01", new Date("2026-01-01T00:00:00.000Z"))).toThrow("Tanggal sumber");
  });
});
