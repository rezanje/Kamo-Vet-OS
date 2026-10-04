import { describe, expect, it } from "vitest";
import { riwayatJurnalRecurring } from "../recurring";

const ID = "f3000000-0000-4000-8000-000000000001";
const complete = {
  no_jurnal: "JRN-FIC-HISTORY", tanggal: "2026-07-01", source_ref: `${ID}:2026-07`,
  journal_lines: [{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }],
};
describe("recurring history reporting", () => {
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
});
