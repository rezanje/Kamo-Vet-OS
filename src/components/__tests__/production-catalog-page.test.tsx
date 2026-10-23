import React from "react";
import { beforeEach, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const fixture = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, failed: "", truncated: "", reads: [] as { table: string; orders: string[]; from?: number }[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from(table: string) {
    let start = 0, end = 999, counted = false;
    const filters: ((row: Row) => boolean)[] = [];
    const read: { table: string; orders: string[]; from?: number } = { table, orders: [] };
    fixture.reads.push(read);
    const query = {
      select(_fields: string, options?: { count: string }) { counted = options?.count === "exact"; return query; },
      eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
      in(key: string, ids: string[]) { filters.push(row => ids.includes(String(row[key]))); return query; },
      order(key: string) { read.orders.push(key); return query; },
      range(from: number, to: number) { start = from; end = to; read.from = from; return query; },
      limit(size: number) { end = size - 1; return query; },
      then(resolve: (value: unknown) => unknown) {
        const rows = (fixture.tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
        const data = rows.slice(start, end + 1);
        if (fixture.truncated === table && start === 500) data.pop();
        return Promise.resolve({ data, count: counted ? rows.length : null,
          error: fixture.failed === table && start === 500 ? { message: "Private fixture error" } : null }).then(resolve);
      },
    };
    return query;
  },
}) }));
vi.mock("@/app/(app)/pos/produksi/actions", () => ({ mulaiProduksi: vi.fn(), selesaikanProduksi: vi.fn(), simpanResep: vi.fn() }));
import Page from "@/app/(app)/pos/produksi/page";

function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(elements)];
}
beforeEach(() => {
  fixture.failed = ""; fixture.truncated = ""; fixture.reads = [];
  fixture.tables = {
    items: Array.from({ length: 1205 }, (_, i) => ({ id: `item-${i}`, code: `SKU-${i}`, name: `Item ${i}`, unit: "pcs", is_active: true, item_type: "Persediaan" })),
    production_recipes: Array.from({ length: 1205 }, (_, i) => ({ id: `recipe-${i}`, nama: `Recipe ${i}`, output_qty: 2, is_active: true, items: { name: `Output ${i}`, code: `SKU-${i}`, unit: "pcs" }, production_recipe_items: [] })),
    warehouses: Array.from({ length: 1205 }, (_, i) => ({ id: `wh-${i}`, name: `Warehouse ${i}`, is_active: true })),
    item_units: [{ item_id: "item-1204", unit: "box", factor: 24, sell_price: 0, buy_price: 0 }],
    production_orders: [],
  };
  fixture.tables.items.push({ ...fixture.tables.items[0], id: "inactive-item", is_active: false }, { ...fixture.tables.items[0], id: "service-item", item_type: "Jasa" });
  fixture.tables.production_recipes.push({ ...fixture.tables.production_recipes[0], id: "inactive-recipe", is_active: false });
  fixture.tables.warehouses.push({ ...fixture.tables.warehouses[0], id: "inactive-warehouse", is_active: false });
});
const page = () => Page({ searchParams: Promise.resolve({}) });

it("supplies every permitted active production product, recipe and warehouse beyond1000 with exact IDs and late units", async () => {
  const nodes = elements(await page());
  const products = nodes.find(node => "barang" in node.props)!.props.barang as { id: string; units: unknown[] }[];
  expect(products).toHaveLength(1205);
  expect(products.at(-1)).toMatchObject({ id: "item-1204", units: expect.arrayContaining([expect.objectContaining({ unit: "box", factor: 24 })]) });
  const options = (name: string) => elements(nodes.find(node => node.type === "select" && node.props.name === name)).filter(node => node.type === "option").map(node => node.props.value).filter(Boolean);
  expect(options("recipe_id")).toHaveLength(1205); expect(options("recipe_id")).toContain("recipe-1204");
  expect(options("warehouse_id")).toHaveLength(1205); expect(options("warehouse_id")).toContain("wh-1204");
  for (const table of ["items", "production_recipes", "warehouses"]) {
    expect(fixture.reads.filter(read => read.table === table).map(read => read.from)).toEqual([0, 500, 1000]);
    expect(fixture.reads.filter(read => read.table === table).every(read => read.orders.at(-1) === "id")).toBe(true);
  }
});
it.each(["items", "production_recipes", "warehouses"])("does not offer actions against failed or truncated %s choices", async table => {
  fixture.failed = table;
  const error = await page().then(() => null, result => result as Error);
  expect(error?.message).toMatch(/belum.*dimuat/i); expect(error?.message).not.toContain("Private fixture");
  fixture.failed = ""; fixture.truncated = table;
  await expect(page()).rejects.toThrow(/belum.*dimuat/i);
});
