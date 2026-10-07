import { expect, it } from "vitest";
import { completeReportQuery } from "../report-query";

it("reads beyond the server's default row cap without losing the selected rows", async () => {
  const rows = Array.from({ length: 6001 }, (_, id) => ({ id: String(id), total: id }));
  const calls: number[] = [];
  const query = { order: () => ({ range: async (from: number, to: number) => {
    calls.push(from);
    return { data: rows.slice(from, to + 1), error: null, count: rows.length };
  } }) };
  expect((await completeReportQuery(query)).data).toEqual(rows);
  expect(calls).toEqual(Array.from({ length: 13 }, (_, index) => index * 500));
});

it("refuses a silently truncated page and a failed query", async () => {
  const query = { order: () => ({ range: async () => ({ data: [{ id: "1" }], error: null, count: 1001 }) }) };
  await expect(completeReportQuery(query)).rejects.toThrow(/terpotong/);
  await expect(completeReportQuery({ order: () => ({ range: async () => ({ data: null, error: { message: "denied" }, count: null }) }) })).rejects.toThrow(/denied/);
});
