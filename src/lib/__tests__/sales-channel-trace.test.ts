import { beforeEach, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ branches: ["branch-a"] as string[] | null }));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => access.branches }));

import { loadSalesChannelTrace } from "@/lib/sales-channel-trace";

beforeEach(() => { access.branches = ["branch-a"]; });

function source(total = 201, fail = false) {
  const calls: { table: string; columns: string; filters: Array<[string, unknown]>; range: [number, number] }[] = [];
  const db = { from: (table: string) => {
    const call = { table, columns: "", filters: [] as Array<[string, unknown]>, range: [0, 0] as [number, number] };
    calls.push(call);
    const query = {
      select: (columns: string) => { call.columns = columns; return query; },
      is: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
      or: (value: string) => { call.filters.push(["or", value]); return query; },
      in: (column: string, value: string[]) => { call.filters.push([column, value]); return query; },
      order: () => query,
      range: async (from: number, to: number) => {
        call.range = [from, to];
        return fail ? { data: null, count: null, error: { message: "fiction read error" } }
          : { data: Array.from({ length: Math.min(to + 1, total) - from }, (_, index) => ({
              id: `sale-${from + index + 1}`, no_struk: `S-${from + index + 1}`,
              created_at: "2026-10-25T00:00:00Z", channel: null, branch_id: "branch-a", customers: null, branches: null,
            })), count: total, error: null };
      },
    };
    return query;
  } };
  return { db, calls };
}

it("reaches an older completed struk without reading or relabeling invoice rows", async () => {
  const { db, calls } = source();
  const page = await loadSalesChannelTrace(db, "fiction-user", "5");
  expect(page.rows.map(row => row.id)).toEqual(["sale-201"]);
  expect(page.count).toBe(201);
  expect(calls.map(call => call.range)).toEqual([[0, 49], [200, 249]]);
  expect(calls.every(call => call.table === "sales")).toBe(true);
  expect(calls.every(call => !call.columns.includes("total") && call.filters.some(([key, value]) => key === "voided_at" && value === null))).toBe(true);
  expect(calls.every(call => call.filters.some(([key, value]) => key === "branch_id" && JSON.stringify(value) === '["branch-a"]'))).toBe(true);
  expect(calls.every(call => call.filters.some(([key, value]) => key === "or" && value === "payment_plan.is.null,payments_finalized_at.not.is.null"))).toBe(true);
});

it("does not query sales when the account has no allowed branch", async () => {
  access.branches = [];
  const { db, calls } = source();
  const page = await loadSalesChannelTrace(db, "fiction-user", "2");
  expect(page.rows).toEqual([]);
  expect(page.count).toBe(0);
  expect(calls).toEqual([]);
});

it("fails closed when a struk page cannot be verified", async () => {
  const { db } = source(201, true);
  await expect(loadSalesChannelTrace(db, "fiction-user", "1")).rejects.toThrow("belum dapat dimuat lengkap");
});
