import { describe, expect, it } from "vitest";
import { riwayatJurnalRecurring } from "../recurring";

const ID = "f3000000-0000-4000-8000-000000000001";
const complete = {
  no_jurnal: "JRN-FIC-HISTORY", tanggal: "2026-07-01", source_ref: `${ID}:2026-07`,
  journal_lines: [{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }],
};
describe("recurring history reporting", () => {
  it.each([
    { tanggal: "2026-06-15", branch_id: null },
    { tanggal: "2026-07-15", branch_id: null },
    { tanggal: "2026-07-01", branch_id: "other-branch" },
  ])("does not count a posting outside its schedule date or branch: %j", (patch) => {
    const result = riwayatJurnalRecurring([{ ...complete, ...patch }], [ID], [{ id: ID, day_of_month: 1, branch_id: null }]);
    expect(result.riwayat.get(ID) ?? []).toHaveLength(0);
    expect(result.bermasalah).toBe(1);
    expect(result.perluDitinjau.has(ID)).toBe(true);
  });
  it("flags duplicate monthly history for the affected schedule, even when one journal is invalid", () => {
    const result = riwayatJurnalRecurring([complete, { ...complete, no_jurnal: "BAD-DATE", tanggal: "2026-06-15" }], [ID], [{ id: ID, day_of_month: 1, branch_id: null }]);
    expect(result.perluDitinjau.has(ID)).toBe(true);
  });
  it("reports complete legacy and full-identity postings under the same schedule", () => {
    const result = riwayatJurnalRecurring([complete, { ...complete, source_ref: "f3000000-2026-06", tanggal: "2026-06-01" }], [ID]);
    expect(result.riwayat.get(ID)?.map((row) => row.periode)).toEqual(["2026-07", "2026-06"]);
    expect(result.bermasalah).toBe(0);
  });
  it("flags empty or unbalanced entries without reporting them as successful runs", () => {
    const result = riwayatJurnalRecurring([
      { ...complete, journal_lines: [] },
      { ...complete, journal_lines: [{ debit: 100, credit: 0 }, { debit: 0, credit: 99 }] },
    ], [ID]);
    expect(result.riwayat.size).toBe(0);
    expect(result.bermasalah).toBe(2);
  });
  it("flags ambiguous legacy identities rather than counting one journal for two schedules", () => {
    const result = riwayatJurnalRecurring([{ ...complete, source_ref: "f3000000-2026-07" }], [ID, "f3000000-0000-4000-8000-000000000002"]);
    expect(result.riwayat.size).toBe(0);
    expect(result.bermasalah).toBe(1);
  });
  it("does not count the same monthly occurrence twice", () => {
    const result = riwayatJurnalRecurring([complete, { ...complete, no_jurnal: "JRN-FIC-DUP" }], [ID]);
    expect(result.riwayat.get(ID)).toHaveLength(1);
    expect(result.bermasalah).toBe(1);
  });

  it("counts SQL-balanced decimal postings without floating-sum errors", () => {
    const result = riwayatJurnalRecurring([{ ...complete, journal_lines: [
      { debit: 100.1, credit: 0 }, { debit: 200.2, credit: 0 }, { debit: 0, credit: 300.3 },
    ] }], [ID]);
    expect(result.riwayat.get(ID)).toHaveLength(1);
    expect(result.perluDitinjau.has(ID)).toBe(false);
    expect(result.bermasalah).toBe(0);
  });
  it("rejects real decimal imbalance below one cent", () => {
    const result = riwayatJurnalRecurring([{ ...complete, journal_lines: [
      { debit: 0.0001, credit: 0 }, { debit: 0, credit: 0.0002 },
    ] }], [ID]);
    expect(result.riwayat.size).toBe(0);
    expect(result.perluDitinjau.has(ID)).toBe(true);
  });
});
