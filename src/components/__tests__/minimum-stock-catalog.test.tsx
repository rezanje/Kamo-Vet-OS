import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ failed: "", truncated: "", reads: [] as { table: string; eq: Record<string, unknown>; ids?: string[] }[] }));
vi.mock("@/app/(app)/pos/stok-minimum/actions", () => ({ buatPOdariUsulan: vi.fn() }));
vi.mock("@/components/LocalTransactionDraft", () => ({ TransactionForm: ({ children }: { children: React.ReactNode }) => <form>{children}</form> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from(table: string) {
    const read = { table, eq: {} } as { table: string; eq: Record<string, unknown>; ids?: string[] }; state.reads.push(read);
    let from = 0, to = 999, counted = false;
    const greater: Record<string, number> = {};
    const query = {
      select(_fields: string, options?: { count: string }) { counted = options?.count === "exact"; return query; },
      eq(key: string, value: unknown) { read.eq[key] = value; return query; },
      gt(key: string, value: number) { greater[key] = value; return query; },
      in(_key: string, ids: string[]) { read.ids = ids; return query; }, order() { return query; },
      range(start: number, end: number) { from = start; to = end; return query; },
      then(resolve: (value: unknown) => unknown) {
        let rows: Row[] = [];
        if (table === "warehouses") rows = Array.from({ length: 1205 }, (_, i) => ({ id: `wh-${i}`, code: `WH-${i}`, name: `Warehouse ${i}`, is_active: true }));
        if (table === "items") rows = [...Array.from({ length: 1205 }, (_, i) => ({ id: `item-${i}`, code: `SKU-${i}`, name: `Fiction ${i}`, unit: "pcs", min_stock: i === 1204 ? 25 : 5, min_buy: 1, buy_price: 2, buy_unit: i === 1204 ? "box" : "pcs", supplier_id: "supplier", suppliers: { nama: "Fictional supplier" }, is_active: true, item_type: "Persediaan" })),
          { id: "inactive", is_active: false, item_type: "Persediaan", min_stock: 5 }, { id: "service", is_active: true, item_type: "Jasa", min_stock: 5 }, { id: "unmonitored", is_active: true, item_type: "Persediaan", min_stock: 0 }];
        if (table === "stock") rows = [...Array.from({ length: 1205 }, (_, i) => ({ id: `stock-${i}`, item_id: `item-${i}`, warehouse_id: "wh-0", qty: 1 })), { id: "other-stock", item_id: "item-1204", warehouse_id: "wh-1", qty: 40 }];
        if (table === "item_units") rows = [{ id: "late-unit", item_id: "item-1204", unit: "box", factor: 12, sell_price: 36, buy_price: 24 }];
        rows = rows.filter(row => Object.entries(read.eq).every(([key, value]) => row[key] === value))
          .filter(row => Object.entries(greater).every(([key, value]) => Number(row[key]) > value))
          .filter(row => !read.ids || read.ids.includes(String(row.item_id)));
        const data = rows.slice(from, to + 1);
        if (state.truncated === table) data.pop();
        return Promise.resolve({ data, count: counted ? rows.length : null, error: state.failed === table ? { message: "private reorder fixture" } : null }).then(resolve);
      },
    };
    return query;
  },
}) }));
import Page from "@/app/(app)/pos/stok-minimum/page";
const render = async (gudang = "") => renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ gudang }) }));
beforeEach(() => { state.failed = ""; state.truncated = ""; state.reads = []; });
it("includes late eligible products and warehouses, retains purchase-unit suggestions, and scopes selected stock", async () => {
  const html = await render("wh-0");
  expect(html).toContain('value="item-1204|supplier|2"'); expect(html).toContain('value="wh-1204"');
  expect(html).not.toContain('value="inactive|'); expect(html).not.toContain('value="service|'); expect(html).not.toContain('value="unmonitored|');
  const stockReads = state.reads.filter(read => read.table === "stock");
  expect(stockReads.every(read => read.ids!.length <= 200 && read.eq.warehouse_id === "wh-0")).toBe(true);
  expect(stockReads.flatMap(read => read.ids!)).toContain("item-1204");
});
it("keeps all-permitted-warehouse aggregation distinct from a selected warehouse without changing reorder math", async () => {
  const html = await render();
  expect(html).not.toContain('value="item-1204|supplier|');
  expect(html).toContain('value="item-0|supplier|4"');
});
it.each(["warehouses", "items", "stock", "item_units"])("blocks a partial or unreadable %s context before suggesting POs", async table => {
  state.failed = table;
  let html = await render("wh-0");
  expect(html).toContain('role="alert"'); expect(html).not.toContain('name="pilih"'); expect(html).not.toContain("private reorder");
  state.failed = ""; state.truncated = table;
  html = await render("wh-0"); expect(html).toContain('role="alert"'); expect(html).not.toContain('name="pilih"');
});
