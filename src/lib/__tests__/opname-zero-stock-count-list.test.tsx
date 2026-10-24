import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ scoped: true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from(table: string) {
    let start = 0, end = 499;
    const rows = () => {
      if (table === "opname_order_items") return fixture.scoped ? [
        { id: "line-1", item_id: "has-stock", items: { code: "SKU-1", name: "First variant", unit: "PCS", sell_price: 100, item_categories: { name: "TEST" } } },
        { id: "line-2", item_id: "zero-stock", items: { code: "SKU-2", name: "Zero variant", unit: "PCS", sell_price: 90, item_categories: { name: "TEST" } } },
      ] : [];
      if (table === "stock") return [
        { id: "stock-1", item_id: "has-stock", items: { code: "SKU-1", name: "First variant", unit: "PCS", sell_price: 100, item_categories: { name: "TEST" } } },
      ];
      return [];
    };
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q,
      range: (from: number, to: number) => { start = from; end = to; return q; },
      then: (resolve: (value: unknown) => unknown) => {
        const all = rows();
        return Promise.resolve({ data: all.slice(start, end + 1), count: all.length, error: null }).then(resolve);
      },
    };
    return q;
  },
}) }));

import { DaftarHitung } from "@/app/kasir/opname/[id]/DaftarHitung";

beforeEach(() => { fixture.scoped = true; });

it("shows a scoped variant with no stock row without exposing system quantities", async () => {
  const form = await DaftarHitung({ orderId: "fiction-order", warehouseId: "fiction-warehouse" });
  expect(form.props.rows.map((row: { item_id: string }) => row.item_id)).toEqual(["has-stock", "zero-stock"]);
  expect(form.props.rows[1]).toMatchObject({ code: "SKU-2", name: "Zero variant" });
  expect(form.props.rows[1]).not.toHaveProperty("qty_sistem");
});

it("still lists warehouse stock for an unrestricted full count", async () => {
  fixture.scoped = false;
  const form = await DaftarHitung({ orderId: "fiction-order", warehouseId: "fiction-warehouse" });
  expect(form.props.rows.map((row: { item_id: string }) => row.item_id)).toEqual(["has-stock"]);
});
