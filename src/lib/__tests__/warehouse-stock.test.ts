import { expect, it } from "vitest";
import { loadWarehouseStock } from "@/lib/warehouse-stock";
it("loads all stock pages so later SKU quantities are never presented as zero", async () => {
  const rows = Array.from({ length: 502 }, (_, i) => ({ id: `s${i}`, warehouse_id: "w", item_id: `i${i}`, qty: i }));
  const client = { from: () => { const query = { select: () => query, in: () => query, order: () => query, range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), count: rows.length, error: null }) }; return query; } };
  expect(await loadWarehouseStock(client, ["w"])).toEqual(rows);
});
it("rejects failed stock reads instead of displaying fabricated zero availability", async () => {
  const client = { from: () => { const query = { select: () => query, in: () => query, order: () => query, range: async () => ({ data: null, count: null, error: new Error("offline") }) }; return query; } };
  await expect(loadWarehouseStock(client, ["w"])).rejects.toThrow("Stok gudang");
});
