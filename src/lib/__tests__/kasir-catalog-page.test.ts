import { beforeEach, expect, it, vi } from "vitest";
import { cocokOr } from "./helpers/postgrest-or";

const fixture = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, failItemsFrom: -1 }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "cashier" } } }) },
  from(table: string) {
    let rows = fixture.tables[table] ?? [];
    let counted = false;
    let start = 0;
    let end = 999;
    const result = () => ({ data: rows.slice(start, end + 1), count: counted ? rows.length : null,
      error: table === "items" && start === fixture.failItemsFrom ? { message: "page unavailable" } : null });
    const query = {
      select: (_columns: string, options?: { count?: string }) => { counted = options?.count === "exact"; return query; },
      eq: (column: string, value: unknown) => { rows = rows.filter(row => row[column] === value); return query; },
      is: () => query,
      lte: (column:string,value:string) => { rows=rows.filter(row=>String(row[column])<=value);return query; },
      or: (ekspresi: string) => { rows = rows.filter(row => cocokOr(row, ekspresi)); return query; },
      in: (column: string, values: unknown[]) => { rows = rows.filter(row => values.includes(row[column])); return query; },
      order: () => query,
      limit: (size: number) => { end = size - 1; return query; },
      range: (from: number, to: number) => { start = from; end = Math.min(to, from + 999); return query; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  },
}) }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ id: "shift", branch_id: "branch", branchName: "Cabang Uji" }) }));
vi.mock("@/lib/penjual", () => ({ daftarPenjual: async () => [] }));
vi.mock("@/lib/satuan", () => ({ loadUnitOptions: async () => new Map() }));
vi.mock("@/app/kasir/KasirClient", () => ({ KasirClient: () => null }));
import KasirPage from "@/app/kasir/page";

beforeEach(() => {
  fixture.failItemsFrom = -1;
  fixture.tables = {
    items: Array.from({ length: 1205 }, (_, index) => ({
      id: `item-${index}`, code: `SKU-${index}`, name: index === 1204 ? "Zebra Tuna" : `Pakan ${index}`,
      unit: "pcs", item_type: "Persediaan", sell_price: 15000, buy_price: 10000,
      is_active: true, category_id: "category", min_sell_qty: 1, default_discount: 0,
      item_categories: { name: "Pakan", parent_id: "parent" },
    })),
    warehouses: [{ id: "warehouse", branch_id: "branch", is_active: true }],
    stock: [], item_branch_prices: [], item_price_tiers: [], category_discounts: [],
  };
  for (let index = 0; index < 1205; index++) {
    fixture.tables.stock.push({ id: `stock-${index}`, warehouse_id: "warehouse", item_id: `item-${index}`, qty: 42 });
    fixture.tables.item_branch_prices.push({ id: `price-${index}`, branch_id: "branch", item_id: `item-${index}`, unit: "pcs", sell_price: 17000 });
    fixture.tables.item_price_tiers.push({ id: `tier-${index}`, item_id: `item-${index}`, min_qty: 5, harga: 16000 });
    fixture.tables.category_discounts.push({ id: `discount-${index}`, customer_category_id: "customer-category", item_id: `item-${index}`, item_category_id: null, diskon_persen: 5 });
  }
});

it("makes products after the API's first 1,000 rows available to cashier search and pagination", async () => {
  const page = await KasirPage({ searchParams: Promise.resolve({}) });
  expect(page.props.items).toHaveLength(1205);
  expect(page.props.items.at(-1)?.name).toBe("Zebra Tuna");
});

it("does not include an unfinished sale in customer purchase history", async () => {
  fixture.tables.customers = [{ id: "customer", name: "Customer", phone: "", points: 0, tier: "New" }];
  fixture.tables.sales = [{ total: 100000, customer_id: "customer" },
    { total: 100000, customer_id: "customer", payment_plan: [{ method: "Tunai", amount: 100000 }], payments_finalized_at: null }];
  const page = await KasirPage({ searchParams: Promise.resolve({}) });
  expect(page.props.customers[0]).toMatchObject({ trx: 1, belanja: 100000 });
});

it("loads stock, branch prices, quantity prices and category discounts for the final product", async () => {
  const page = await KasirPage({ searchParams: Promise.resolve({}) });
  const last = page.props.items.find((item: { id: string }) => item.id === "item-1204");
  expect(last).toMatchObject({ stok: 42, harga: 17000, tiers: [{ min_qty: 5, harga: 16000 }] });
  expect(page.props.infoBarang["item-1204"]).toMatchObject({ category_id: "category", parent_category_id: "parent" });
  expect(page.props.aturanDiskon["customer-category"]).toHaveLength(1205);
});

it("fails visibly when a later catalogue page is unavailable instead of showing a truncated list", async () => {
  fixture.failItemsFrom = 500;
  const outcome = await KasirPage({ searchParams: Promise.resolve({}) }).then(() => "partial catalogue", error => error.message);
  expect(outcome).toMatch(/belum.*(dapat dimuat|dimuat lengkap)/);
});

it("loads all group components even when a group has more than 1,000 component rows", async () => {
  fixture.tables.items.push({ ...fixture.tables.items[0], id: "group", name: "Paket lengkap", item_type: "Grup" });
  fixture.tables.item_group_components = fixture.tables.items.slice(0, 1002).map((item, index) => ({
    id: `component-${index}`, group_item_id: "group", component_item_id: item.id, qty: 1,
    unit: "pcs", factor: 1, sort_order: index, component: item,
  }));
  const page = await KasirPage({ searchParams: Promise.resolve({}) });
  expect(page.props.items.find((item: { id: string }) => item.id === "group")?.groupComponents).toHaveLength(1002);
});

it("keeps the cashier available when the shared discount master exceeds 10,000 rules", async () => {
  fixture.tables.category_discounts = Array.from({ length: 12005 }, (_, index) => ({
    id: `rule-${index}`, customer_category_id: "customer-category", item_id: `item-${index}`, item_category_id: null, diskon_persen: 5,
  }));
  const outcome = await KasirPage({ searchParams: Promise.resolve({}) })
    .then(page => page.props.aturanDiskon["customer-category"].length, error => error.message);
  expect(outcome).toBe(12005);
});
