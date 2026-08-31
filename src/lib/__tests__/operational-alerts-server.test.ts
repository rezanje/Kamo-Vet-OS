import { describe, expect, it } from "vitest";
import { collectOperationalAlertBlock } from "../operational-alerts-server";

function fakeSupabase(options: { errorTable?: string } = {}) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const from = (table: string) => {
    const result = { data: table === "profiles"
      ? [{ role: "OWNER" }]
      : table === "branches"
        ? [{ id: "b1", name: "Cabang Satu" }]
        : table === "warehouses"
          ? [{ id: "w1", branch_id: "b1" }]
          : [], error: options.errorTable === table ? { message: "query gagal", code: "500" } : null };
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "gte", "lte", "gt", "lt", "is", "not", "neq", "order", "limit"]) {
      query[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return query;
      };
    }
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return query;
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from,
    rpc: async () => ({ data: true, error: null }),
    calls,
  };
}

describe("operational alert server", () => {
  it("menghasilkan diagnostik missing dan tetap membatasi sumber stok ke cabang", async () => {
    const supabase = fakeSupabase();
    const result = await collectOperationalAlertBlock(supabase, {
      from: "2026-08-01",
      to: "2026-08-31",
      branchIds: ["b1"],
      channel: "all",
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.data.missing.length).toBeGreaterThan(0);
    const warehouse = supabase.calls.filter((call) => call.table === "warehouses");
    expect(warehouse.some((call) => call.method === "in" && JSON.stringify(call.args).includes("b1"))).toBe(true);
    const layers = supabase.calls.filter((call) => call.table === "stock_layers");
    expect(layers.some((call) => call.method === "in" && JSON.stringify(call.args).includes("w1"))).toBe(true);
  });

  it("mengembalikan correlation ID saat sumber alert gagal", async () => {
    const result = await collectOperationalAlertBlock(fakeSupabase({ errorTable: "stock" }), {
      from: "2026-08-01",
      to: "2026-08-31",
      branchIds: ["b1"],
      channel: "all",
    });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.correlationId).toBeTruthy();
  });
});
