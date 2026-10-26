import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadProductionSkuHistory } from "@/lib/production-sku-history";

const recipe = { id: "recipe-1", item_id: "sku-1" };
const adhoc = { id: "job-a", no_produksi: "PRD.A", recipe_id: null, output_item_id: "sku-1", status: "selesai", tanggal: "2026-10-20", qty_jadi: 5, nilai_bahan: 20 };
const fromRecipe = { id: "job-r", no_produksi: "PRD.R", recipe_id: "recipe-1", output_item_id: null, status: "berjalan", tanggal: "2026-10-21", qty_jadi: 0, nilai_bahan: 12 };

function client(options: { badOutput?: boolean; denied?: boolean; noProof?: boolean } = {}) {
  const calls: { table: string; filters: unknown[][] }[] = [];
  const rpcCalls: string[][] = [];
  const fake = {
    from(table: string) {
      const call = { table, filters: [] as unknown[][] }; calls.push(call);
      const q = {
        select: () => q,
        eq: (field: string, value: unknown) => { call.filters.push(["eq", field, value]); return q; },
        in: (field: string, value: unknown) => { call.filters.push(["in", field, value]); return q; },
        order: () => q,
        range: (from: number, to: number) => {
          const rows = table === "production_recipes" ? [recipe] :
            call.filters.some(filter => filter[0] === "eq") ? [{ ...adhoc, output_item_id: options.badOutput ? "other" : "sku-1" }] : [fromRecipe];
          return Promise.resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null });
        },
      };
      return q;
    },
    async rpc(name: string, args: { p_order_ids: string[] }) {
      expect(name).toBe("read_production_atomic_sources");
      rpcCalls.push(args.p_order_ids);
      return options.denied ? { data: null, error: { message: "denied" } } :
        { data: Object.fromEntries(args.p_order_ids.filter(id => !options.noProof || id !== "job-r").map(id => [id, { output_name: "Stored output" }])), error: null };
    },
  };
  return { db: fake as unknown as SupabaseClient, calls, rpcCalls };
}

it("joins only exact saved output SKUs, verifies source access, and sorts linked production documents", async () => {
  const fixture = client();
  const rows = await loadProductionSkuHistory(fixture.db, "sku-1");
  expect(rows.map(row => row.no_produksi)).toEqual(["PRD.R", "PRD.A"]);
  expect(fixture.calls.map(call => call.filters)).toEqual([
    [["eq", "item_id", "sku-1"]],
    [["eq", "output_item_id", "sku-1"]],
    [["in", "recipe_id", ["recipe-1"]]],
  ]);
  expect(fixture.rpcCalls).toEqual([["job-a", "job-r"]]);
});

it("does not expose an order without source proof", async () => {
  expect((await loadProductionSkuHistory(client({ noProof: true }).db, "sku-1")).map(row => row.id)).toEqual(["job-a"]);
});

it("fails closed on an inconsistent output identity or denied source reader", async () => {
  await expect(loadProductionSkuHistory(client({ badOutput: true }).db, "sku-1")).rejects.toThrow("tidak sesuai SKU");
  await expect(loadProductionSkuHistory(client({ denied: true }).db, "sku-1")).rejects.toThrow("belum dapat diperiksa");
});
