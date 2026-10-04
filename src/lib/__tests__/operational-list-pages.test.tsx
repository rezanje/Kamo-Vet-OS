import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, failedTable: "", calls: [] as { table: string; orders: string[]; filters: [string, unknown][]; range?: [number, number] }[] }));
vi.stubGlobal("React", React);
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from(table: string) {
    const call = { table, orders: [] as string[], filters: [] as [string, unknown][], range: undefined as [number, number] | undefined };
    fixture.calls.push(call);
    let counted = false;
    let limit = 1000;
    const query = {
      select(_fields: string, opts?: { count: string }) { counted = opts?.count === "exact"; return query; },
      order(field: string) { call.orders.push(field); return query; },
      eq(field: string, value: unknown) { call.filters.push([field, value]); return query; },
      limit(value: number) { limit = value; return query; },
      range(from: number, to: number) { call.range = [from, to]; return query; },
      maybeSingle: async () => ({ data: { role: "OWNER" }, error: null }),
      then(resolve: (v: unknown) => void) {
        const source = (fixture.tables[table] ?? []).filter((r) => call.filters.every(([key, value]) => r[key] === value));
        const [from, to] = call.range ?? [0, limit - 1];
        return Promise.resolve({ data: fixture.failedTable === table ? null : source.slice(from, to + 1), count: counted ? source.length : null, error: fixture.failedTable === table ? { message: "private DB detail" } : null }).then(resolve);
      },
    };
    return query;
  },
}) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...props}>{children}</a> }));
vi.mock("../../app/(app)/pos/stok/ResetSimulasiForm", () => ({ ResetSimulasiForm: () => null }));
import CustomersPage from "../../app/(app)/crm/pelanggan/page";
import MedicalPage from "../../app/(app)/klinik/rekam-medis/page";
import StockPage from "../../app/(app)/pos/stok/page";

function customerProps(node: React.ReactNode): { customers: { id: string }[] } | null {
  if (!React.isValidElement<{ customers?: { id: string }[]; children?: React.ReactNode }>(node)) return null;
  if (node.props.customers) return { customers: node.props.customers };
  for (const child of React.Children.toArray(node.props.children)) { const found = customerProps(child); if (found) return found; }
  return null;
}
const tableRows = (html: string) => (html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr/g) ?? []).length;

beforeEach(() => {
  fixture.calls = [];
  fixture.failedTable = "";
  fixture.tables = {
    customers: Array.from({ length: 1200 }, (_, i) => ({ id: `customer-${i}`, name: `Owner ${i}`, phone: `08${i}`, pets: [] })),
    customer_categories: [], customer_review_statuses: [],
    warehouses: [{ id: "wh-a", code: "WH-A", name: "Warehouse A", is_active: true }],
    visits: Array.from({ length: 350 }, (_, i) => ({ id: `visit-${i}`, pet_id: "pet-a", created_at: "2020-01-01T00:00:00Z", pets: { name: `Pet ${i}` }, customers: { name: `Owner ${i}`, phone: `08${i}` }, branches: { code: "A" }, medical_records: { diagnosis: "Fictional" } })),
    stock: Array.from({ length: 1200 }, (_, i) => ({ id: `stock-${i}`, warehouse_id: "wh-a", item_id: `item-${i}`, qty: 1, warehouses: { code: "WH-A" }, items: { id: `item-${i}`, code: `SKU-${i}`, name: `Item ${i}`, unit: "pcs" } })),
  };
});

describe("complete operational page sources", () => {
  it.each([
    ["customers", CustomersPage], ["visits", MedicalPage], ["stock", StockPage], ["warehouses", StockPage],
  ] as const)("shows an alert instead of empty data when %s source fails", async (table, page) => {
    fixture.failedTable = table;
    const html = renderToStaticMarkup(await page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("private DB detail");
    expect(html).not.toContain("<table");
  });
  it("loads all 1200 customers for full summaries and client search", async () => {
    const page = await CustomersPage({ searchParams: Promise.resolve({}) });
    expect(customerProps(page)?.customers).toHaveLength(1200);
    expect(fixture.calls.filter((c) => c.table === "customers").every((c) => c.orders.at(-1) === "id")).toBe(true);
  });
  it("searches medical history beyond the former 300-row cap and preserves pet scope", async () => {
    const html = renderToStaticMarkup(await MedicalPage({ searchParams: Promise.resolve({ q: "Pet 349", pet: "pet-a" }) }));
    expect(html).toContain("Pet 349");
    expect(html).toContain("350");
    expect(tableRows(html)).toBe(1);
    expect(fixture.calls.filter((c) => c.table === "visits").every((c) => c.filters.some(([k, v]) => k === "pet_id" && v === "pet-a") && c.orders.at(-1) === "id")).toBe(true);
  });
  it("counts distinct animal IDs rather than treating every visit name as another animal", async () => {
    const html = renderToStaticMarkup(await MedicalPage({ searchParams: Promise.resolve({}) }));
    expect(html).toMatch(/HEWAN TERCATAT<\/div><div[^>]*>1<\/div>/);
  });
  it("renders medical 50-row pages with q and pet preserved", async () => {
    const html = renderToStaticMarkup(await MedicalPage({ searchParams: Promise.resolve({ q: "Pet", pet: "pet-a", hal: "7" }) }));
    expect(tableRows(html)).toBe(50);
    expect(html).toContain("Pet 349");
    expect(html).not.toContain("Pet 0</div>");
    expect(html).toMatch(/q=Pet(?:&amp;|&)pet=pet-a(?:&amp;|&)hal=6/);
  });
  it("renders only selected warehouse page 24 while preserving truthful total and stable ordering", async () => {
    const html = renderToStaticMarkup(await StockPage({ searchParams: Promise.resolve({ wh: "wh-a", hal: "24" }) }));
    expect(tableRows(html)).toBe(50);
    expect(html).toContain("SKU-1199");
    expect(html).not.toContain("SKU-0</td>");
    expect(html).toContain("1200");
    const calls = fixture.calls.filter((c) => c.table === "stock");
    expect(calls.every((c) => c.orders.join(",") === "updated_at,id" && c.filters.some(([k, v]) => k === "warehouse_id" && v === "wh-a"))).toBe(true);
  });
  it("keeps all matrix quantities while rendering page 24 and preserving matrix mode", async () => {
    const html = renderToStaticMarkup(await StockPage({ searchParams: Promise.resolve({ wh: "all", hal: "24" }) }));
    expect(tableRows(html)).toBe(50);
    expect(html).toContain("1200 barang");
    expect(html).toMatch(/wh=all(?:&amp;|&)hal=23/);
    expect(fixture.calls.filter((c) => c.table === "stock").every((c) => c.orders.at(-1) === "id")).toBe(true);
  });
});
