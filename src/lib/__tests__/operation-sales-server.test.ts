import { describe, expect, it } from "vitest";
import { collectDashboard, resolveDashboardScope } from "../operation-sales-server";

type QueryRecord = { table: string; calls: { method: string; args: unknown[] }[] };

function fakeSupabase(options: {
  role?: string;
  assignments?: string[];
  branches?: { id: string; name: string }[];
  errors?: Record<string, { message: string; code?: string }>;
}) {
  const records: QueryRecord[] = [];
  const errors = options.errors ?? {};
  const from = (table: string) => {
    const record: QueryRecord = { table, calls: [] };
    records.push(record);
    const result = { data: table === "profiles"
      ? [{ role: options.role ?? "OWNER" }]
      : table === "user_branches"
        ? (options.assignments ?? []).map((branch_id) => ({ branch_id }))
        : table === "branches"
          ? (options.branches ?? [{ id: "b1", name: "Cabang Satu" }])
          : table === "warehouses"
            ? [{ id: "w1", branch_id: "b1" }]
          : [], error: errors[table] ?? null };
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "gte", "lte", "lt", "gt", "is", "not", "neq", "order", "limit", "maybeSingle"]) {
      query[method] = (...args: unknown[]) => {
        record.calls.push({ method, args });
        return query;
      };
    }
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return query;
  };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from,
    rpc: async (name: string, args: Record<string, unknown>) => {
      records.push({ table: `rpc:${name}`, calls: [{ method: "rpc", args: [args] }] });
      return { data: args.b === "foreign" ? false : true, error: null };
    },
    records,
  };
  return supabase;
}

describe("operation sales server collector", () => {
  it("menolak cabang asing sebelum query blok dashboard berjalan", async () => {
    const supabase = fakeSupabase({ role: "STAFF", assignments: ["b1"] });

    await expect(resolveDashboardScope(supabase, ["foreign"])).rejects.toThrow("Akses cabang ditolak");
    expect(supabase.records.some((record) => ["sales", "stock", "purchase_orders", "bookings", "visits"].includes(record.table))).toBe(false);
  });

  it("mengirim periode dan branch scope ke query data", async () => {
    const supabase = fakeSupabase({ role: "OWNER", branches: [{ id: "b1", name: "Cabang Satu" }] });
    const result = await collectDashboard(supabase, {
      from: "2026-08-01",
      to: "2026-08-31",
      branchIds: ["b1"],
      channel: "all",
    });

    expect(result.sales.status).toBe("ready");
    for (const table of ["sales", "visits", "bookings", "purchase_orders", "stock_moves"]) {
      const records = supabase.records.filter((record) => record.table === table);
      expect(records.length, table).toBeGreaterThan(0);
      const calls = records.flatMap((record) => record.calls);
      const scopedId = table === "stock_moves" ? "w1" : "b1";
      expect(calls.some((call) => call.method === "in" && JSON.stringify(call.args).includes(scopedId)), table).toBe(true);
      expect(calls.some((call) => call.method === "gte" && JSON.stringify(call.args).includes("2026-08-01")), table).toBe(true);
      expect(calls.some((call) => call.method === "lte" && JSON.stringify(call.args).includes("2026-08-31")), table).toBe(true);
    }
    const warehouseCalls = supabase.records.filter((record) => record.table === "warehouses").flatMap((record) => record.calls);
    expect(warehouseCalls.some((call) => call.method === "in" && JSON.stringify(call.args).includes("b1"))).toBe(true);
  });

  it("mengembalikan agregat dan mempertahankan blok lain saat satu query gagal", async () => {
    const supabase = fakeSupabase({
      role: "OWNER",
      branches: [{ id: "b1", name: "Cabang Satu" }],
      errors: { purchase_orders: { message: "query gagal", code: "500" } },
    });
    const result = await collectDashboard(supabase, {
      from: "2026-08-01",
      to: "2026-08-31",
      branchIds: ["b1"],
      channel: "all",
    });

    expect(result.sales.status).toBe("ready");
    expect(result.sales).not.toHaveProperty("rows");
    expect(result.purchase.status).toBe("error");
    if (result.purchase.status === "error") expect(result.purchase.correlationId).toBeTruthy();
  });
});
