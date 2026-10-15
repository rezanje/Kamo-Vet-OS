import { describe, expect, it } from "vitest";
import { collectDashboard, resolveDashboardScope } from "../operation-sales-server";

type QueryRecord = { table: string; calls: { method: string; args: unknown[] }[] };

function fakeSupabase(options: {
  role?: string;
  assignments?: string[];
  branches?: { id: string; name: string }[];
  errors?: Record<string, { message: string; code?: string }>;
  layers?: { warehouse_id: string; item_id: string; qty_left: number; unit_cost: number }[];
  sales?: Record<string, unknown>[];
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
          : table === "stock_layers"
            ? options.layers ?? []
          : table === "sales" ? options.sales ?? [] : [], error: errors[table] ?? null };
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
  it("counts finalized split sales once in revenue and customer spending while excluding pending sales", async () => {
    const sale = { id: "sale", total: 100000, branch_id: "b1", customer_id: "c1", channel: null, created_at: "2026-08-15T05:00:00Z",
      sale_items: [{ item_id: "item", qty: 1, harga: 100000, hpp: 50000 }],
      payment_plan: [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }], payments_finalized_at: "2026-08-15T05:00:01Z" };
    const result = await collectDashboard(fakeSupabase({ sales: [sale, { ...sale, id: "pending", payments_finalized_at: null }] }), {
      from: "2026-08-01", to: "2026-08-31", branchIds: ["b1"], channel: "all",
    });
    expect(result.sales).toMatchObject({ status: "ready", data: { metrics: { sales: 100000, transactions: 1 } } });
    expect(result.customer).toMatchObject({ status: "ready", data: { topSpenders: [{ customerId: "c1", spending: 100000 }] } });
  });

  it.each(["ADMIN", "OWNER", "FINANCE"])("tidak membaca atau menyerialisasi biaya FIFO pada dashboard %s", async role => {
    const supabase = fakeSupabase({ role, layers: [
      { warehouse_id: "w1", item_id: "i1", qty_left: 2.5, unit_cost: 120 },
      { warehouse_id: "w1", item_id: "i1", qty_left: 3, unit_cost: 200 },
    ] });
    const result = await collectDashboard(supabase, {
      from: "2026-08-01", to: "2026-08-31", branchIds: ["b1"], channel: "all",
    });
    expect(result.stock.status).toBe("ready");
    expect(supabase.records.some(record => record.table === "stock_layers")).toBe(false);
    expect(JSON.stringify(result.stock)).not.toMatch(/stockValue|unit_cost|unitCost/);
    if (result.stock.status === "ready") expect(result.stock.data).toHaveProperty("coverageDays");
  });
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
