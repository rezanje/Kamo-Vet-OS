import React from "react";
import { beforeEach, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ failed: "", truncated: "", stock: vi.fn(async (client: unknown, ids: string[]) => { void client; void ids; return []; }), units: vi.fn(async (client: unknown, ids: string[]) => { void client; return new Map(ids.map(id => [id, [{ unit: "pcs", factor: 1, sell_price: 10, buy_price: 6 }]])); }) }));
vi.mock("@/lib/warehouse-stock", () => ({ loadWarehouseStock: state.stock }));
vi.mock("@/lib/satuan", async original => ({ ...await original<typeof import("@/lib/satuan")>(), loadItemUnits: state.units, loadUnitOptions: state.units }));
vi.mock("@/app/(app)/pembelian/baru/POForm", () => ({ POForm: () => null }));
vi.mock("@/app/(app)/pembelian/faktur/langsung/FakturLangsungForm", () => ({ FakturLangsungForm: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from(table: string) {
    let from = 0, to = 999, counted = false;
    const filters: ((row: Row) => boolean)[] = [];
    const query = {
      select(_fields: string, options?: { count: string }) { counted = options?.count === "exact"; return query; },
      eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; }, order() { return query; },
      range(start: number, end: number) { from = start; to = end; return query; },
      then(resolve: (value: unknown) => unknown) {
        const rows = [...Array.from({ length: 1205 }, (_, i) => ({ id: `${table}-${i}`, code: `CODE-${i}`, name: `Name ${i}`, nama: `Name ${i}`, unit: "pcs", sell_price: 10, buy_price: 6, item_type: "Persediaan", is_active: true, termin_hari: 14, branches: { name: "Fictional branch" } })),
          { id: "inactive", code: "OLD", name: "Inactive", nama: "Inactive", is_active: false },
        ].filter(row => filters.every(filter => filter(row)));
        const data = rows.slice(from, to + 1);
        if (state.truncated === table && from === 500) data.pop();
        return Promise.resolve({ data, count: counted ? rows.length : null,
          error: state.failed === table && from === 500 ? { message: "private purchase fixture" } : null }).then(resolve);
      },
    };
    return query;
  },
}) }));
import POPage from "@/app/(app)/pembelian/baru/page";
import DirectPage from "@/app/(app)/pembelian/faktur/langsung/page";
function props(node: React.ReactNode): Record<string, unknown> | undefined {
  if (!React.isValidElement<Record<string, unknown>>(node)) return;
  if ("items" in node.props && "suppliers" in node.props) return node.props;
  for (const child of React.Children.toArray(node.props.children as React.ReactNode)) { const found = props(child); if (found) return found; }
}
const po = () => POPage({ searchParams: Promise.resolve({}) });
const direct = () => DirectPage({ searchParams: Promise.resolve({}) });
beforeEach(() => { state.failed = ""; state.truncated = ""; state.stock.mockClear(); state.units.mockClear(); });
it.each([["PO", po], ["direct invoice", direct]] as const)("%s loads all reference choices while preserving existing active/eligibility filters", async (name, page) => {
  const form = props(await page())!;
  expect(form.items).toHaveLength(1205); expect(form.suppliers).toHaveLength(1205);
  expect(form.warehouses).toHaveLength(name === "PO" ? 1206 : 1205);
  expect(form.suppliers).toEqual(expect.arrayContaining([expect.objectContaining({ id: "suppliers-1204" })]));
  expect(form.warehouses).toEqual(expect.arrayContaining([expect.objectContaining({ id: "warehouses-1204" })]));
  if (name === "PO") {
    expect(form.branches).toHaveLength(1206);
    expect(state.stock.mock.calls.every(([, ids]) => ids.length <= 200)).toBe(true);
    expect(state.stock.mock.calls.flatMap(([, ids]) => ids)).toHaveLength(1206);
  } else expect(form.suppliers).toEqual(expect.arrayContaining([expect.objectContaining({ id: "suppliers-1204", terminHari: 14 })]));
});
it.each([["PO suppliers", po, "suppliers"], ["PO warehouses", po, "warehouses"], ["PO branches", po, "branches"], ["direct suppliers", direct, "suppliers"], ["direct warehouses", direct, "warehouses"]] as const)("%s rejects failed/truncated reference context", async (_name, page, table) => {
  state.failed = table;
  const error = await page().then(() => null, result => result as Error);
  expect(error?.message).toMatch(/belum.*dimuat/i); expect(error?.message).not.toContain("private purchase");
  state.failed = ""; state.truncated = table;
  await expect(page()).rejects.toThrow(/belum.*dimuat/i);
});
