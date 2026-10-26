import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readCompoundProductionTrace } from "@/lib/compound-production-trace";

function client(data: unknown, error: unknown = null) {
  const calls: unknown[] = [];
  return { db: { rpc: async (...args: unknown[]) => { calls.push(args); return { data, error }; } } as unknown as SupabaseClient, calls };
}

const source = {
  ingredient_id: "ingredient", material_item_id: "material", production_order_id: "job",
  no_produksi: "PRD.FICTION.001", restored: false,
};

it("reads only the authorized exact-layer RPC and deduplicates split FIFO layers", async () => {
  const fixture = client([source, source]);
  expect(await readCompoundProductionTrace(fixture.db, "recipe")).toEqual([source]);
  expect(fixture.calls).toEqual([["read_compound_production_layer_trace", { p_recipe_id: "recipe" }]]);
});

it("keeps restored issues distinct from active consumption", async () => {
  const fixture = client([source, { ...source, restored: true }]);
  expect((await readCompoundProductionTrace(fixture.db, "recipe")).map(row => row.restored)).toEqual([false, true]);
});

it("fails closed on denied or malformed private-source results", async () => {
  await expect(readCompoundProductionTrace(client(null, { message: "denied" }).db, "recipe")).rejects.toThrow("belum dapat diperiksa");
  await expect(readCompoundProductionTrace(client([{ ...source, no_produksi: null }]).db, "recipe")).rejects.toThrow("tidak valid");
});
